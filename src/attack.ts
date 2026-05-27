import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";
import { writeFile } from "node:fs/promises";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import { createReadTool, createSearchTool, createCrawlTool, createCommandTool } from "./tools.js";
import { createScanSecretsTool, createScanOwaspTool } from "./scanner/codebase.js";
import { createScanPortsTool, createScanDnsTool } from "./scanner/network.js";
import {
  createReconProcessesTool, createReconNetworkTool, createReconUsersTool,
  createReconSchedulerTool, createReconSuidTool,
} from "./offense/recon.js";
import { createPrivescSudoTool, createPrivescWritableTool, createPrivescKernelTool } from "./offense/privesc.js";
import { createPersistSshKeysTool, createPersistStartupTool, createPersistSshConfigTool } from "./offense/persistence.js";
import { createExploitPackageVulnsTool, createExploitServiceScanTool } from "./offense/exploit.js";
import { createReportTool } from "./offense/report.js";
import { parseTarget, SshSession, targetHost } from "./transport.js";
import { setRemoteExec } from "./execContext.js";
import { setStealthConfig, stealthDelay } from "./stealth.js";
import { runProfiler } from "./profiler.js";

function isSshTarget(target: string): boolean {
  return target.includes("@")
    || (!target.startsWith(".") && !target.startsWith("/") && target.includes("."));
}

/**
 * Run an offense-mode security assessment against a target.
 *
 * @param target    - SSH target (user@host[:port]) or local path (./path)
 * @param config    - Ananse configuration
 * @param opts      - { recon?: boolean; all?: boolean; stealth?: boolean }
 * @param outputPath - Optional file path to write the report
 */
export async function runAttack(
  target: string,
  config: AnanseConfig,
  opts: { recon?: boolean; all?: boolean; stealth?: boolean },
  outputPath?: string,
): Promise<void> {
  if (!config.apiKey) {
    console.error(picocolors.red("Error: No API key found."));
    return;
  }

  const model = createModelFromConfig(config, "offense");
  if (!model) {
    console.error(picocolors.red(`Error: Unknown provider "${config.provider}".`));
    return;
  }

  const personality = await loadPersonality();
  const personalitySection = personality ? `\nProject context:\n${personality}` : "";
  const isRemote = isSshTarget(target);
  const stealth = opts.stealth === true;

  let sshSession: SshSession | undefined;
  let targetLabel = target;
  let profileContext: string | null = null;

  if (isRemote) {
    const sshTarget = parseTarget(target);
    targetLabel = targetHost(sshTarget);

    // Initial guard config before profiling (conservative)
    if (stealth) {
      setStealthConfig({
        enabled: true,
        minDelay: 5000,
        maxDelay: 15000,
        avoidHighRiskCommands: true,
      });
    }

    console.log(picocolors.cyan(`  Connecting to ${targetLabel}...${stealth ? picocolors.dim(" (stealth)") : ""}`));

    sshSession = new SshSession(sshTarget, stealth ? { enabled: true, minDelay: 5000, maxDelay: 15000, avoidHighRiskCommands: true } : undefined);
    try {
      await sshSession.connect();
      console.log(picocolors.green(`  Connected.${stealth ? picocolors.dim(" (stealth mode)") : ""}\n`));
    } catch (err) {
      console.error(picocolors.red(`\n  SSH connection failed: ${(err as Error).message}`));
      return;
    }

    // Route all security-tool sh() calls through SSH
    setRemoteExec((cmd, timeout) => sshSession!.exec(cmd, timeout));

    // Profiling: probe target defenses and tune stealth config dynamically
    if (stealth) {
      const result = await runProfiler(sshSession);
      if (result.profile && result.adaptedConfig) {
        setStealthConfig(result.adaptedConfig);
        sshSession.updateStealthConfig(result.adaptedConfig);
        profileContext = result.contextBlock;
      }
    }
  } else if (stealth) {
    // Local targets: use standard stealth (no profiling needed)
    setStealthConfig({
      enabled: true,
      minDelay: 5000,
      maxDelay: 15000,
      avoidHighRiskCommands: true,
    });
  }

  const commandTool = createCommandTool(
    isRemote && sshSession
      ? (cmd, timeout) => sshSession.exec(cmd, timeout)
      : undefined,
  );

  // Build the tool set
  const tools: Record<string, unknown> = {
    // Core
    read: createReadTool(),
    search: createSearchTool(),
    crawl: createCrawlTool(),
    command: commandTool,
    // Codebase scanners
    scan_secrets: createScanSecretsTool(),
    scan_owasp: createScanOwaspTool(),
    // Reporting
    report: createReportTool(),
  };

  if (isRemote) {
    // System-level offense tools — only for remote targets
    Object.assign(tools, {
      scan_ports: createScanPortsTool(),
      scan_dns: createScanDnsTool(),
      recon_processes: createReconProcessesTool(),
      recon_network: createReconNetworkTool(),
      recon_users: createReconUsersTool(),
      recon_scheduler: createReconSchedulerTool(),
      recon_suid: createReconSuidTool(),
      privesc_sudo: createPrivescSudoTool(),
      privesc_writable: createPrivescWritableTool(),
      privesc_kernel: createPrivescKernelTool(),
      persist_ssh_keys: createPersistSshKeysTool(),
      persist_startup: createPersistStartupTool(),
      persist_ssh_config: createPersistSshConfigTool(),
      exploit_package_vulns: createExploitPackageVulnsTool(),
      exploit_service_scan: createExploitServiceScanTool(),
    });
  }

  const scopeHint = isRemote
    ? `Remote target: ${targetLabel} (SSH — system-level assessment)`
    : `Local path: ${target} (codebase audit)`;
  const typeHint = opts.recon ? "reconnaissance only" : opts.all ? "full pentest suite" : "standard security assessment";

  const steps = opts.recon ? 12 : 25;

  const agent = new ToolLoopAgent({
    model,
    instructions: [
      "You are Ananse, operating in OFFENSE mode — a security auditor with a red-team mindset.",
      "",
      scopeHint,
      `Assessment type: ${typeHint}`,
      "",
      isRemote
        ? "Work through these phases systematically:"
        : "Scan the codebase for security vulnerabilities:",
      ...(isRemote
        ? [
          "1. RECONNAISSANCE — enumerate processes, network, users, cron, SUID binaries",
          "2. PRIVILEGE ESCALATION — check sudo, writable scripts, kernel exploits",
          "3. PERSISTENCE — audit SSH keys, startup files, backdoor vectors",
          "4. EXPLOITATION — check vulnerable packages and exposed services",
          "5. REPORT — use the report tool to save a structured pentest report",
        ]
        : [
          "1. Scan for hardcoded secrets and API keys",
          "2. Check for OWASP Top 10 patterns (injection, XSS, path traversal)",
          "3. Review file permissions and sensitive data exposure",
          "4. Report all findings with severity levels",
        ]),
      "",
      "Rules:",
      "- Use the dedicated tools (recon_processes, privesc_sudo, etc.) where available.",
      "- Do NOT modify any files on the target.",
      "- Report every finding with severity: CRITICAL, HIGH, MEDIUM, or LOW.",
      "- Include evidence (command output, file snippets) for each finding.",
      "- Use the report tool at the end to generate a structured pentest report.",
      ...(opts.recon
        ? ["", "Scope limited to reconnaissance only. Skip exploitation and full reporting."]
        : []),
      ...(stealth && profileContext
        ? ["", profileContext]
        : []),
      ...(stealth && !profileContext
        ? ["", "STEALTH MODE: Avoid sudo commands, full filesystem scans, and auditd interaction. Run quietly."]
        : []),
      personalitySection,
    ].filter(Boolean).join("\n"),
    tools: tools as any,
    stopWhen: stepCountIs(steps),
    onStepFinish: (step) => {
      for (const call of step.toolCalls) {
        const args = JSON.stringify(call.input);
        console.log(picocolors.dim(`  → ${call.toolName}${args.length > 2 ? " " + args.slice(0, 100) : ""}`));
      }
    },
  });

  const actionLabel = opts.recon ? "reconnaissance" : opts.all ? "full pentest" : "security assessment";
  console.log(picocolors.cyan(`\n  Running ${actionLabel} on ${picocolors.white(targetLabel)}...`));
  console.log(picocolors.dim(`  (read-only — up to ${steps} steps)\n`));

  try {
    if (stealth) await stealthDelay();
    const result = await agent.generate({
      prompt: `Run a ${typeHint} against ${targetLabel}. Be thorough — report ALL findings with severity levels and evidence.`,
    });

    const report = result.text ?? "(no findings)";

    console.log("\n" + picocolors.cyan(`╭── Offense Report: ${targetLabel} ──────────────────────`));
    console.log(report);
    console.log(picocolors.cyan("└──────────────────────────────────────────────────────────"));

    if (outputPath) {
      await writeFile(outputPath, report, "utf-8");
      console.log(picocolors.green(`\n  Report written to ${picocolors.white(outputPath)}`));
    }
  } catch (error) {
    console.error(
      picocolors.red(`\nAttack error: ${error instanceof Error ? error.message : String(error)}`),
    );
  } finally {
    setRemoteExec(null);
    if (sshSession) await sshSession.close().catch(() => {});
  }
}
