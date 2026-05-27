import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";
import { writeFile } from "node:fs/promises";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import { createReadTool, createSearchTool, createCrawlTool, createCommandTool } from "./tools.js";
import { createScanSecretsTool, createScanOwaspTool } from "./scanner/codebase.js";
import {
  createMonitorFimSnapshotTool, createMonitorFimCheckTool,
  createMonitorRootkitTool, createMonitorProcessesTool,
} from "./defense/monitor.js";
import {
  createComplianceSshTool, createCompliancePasswordTool,
  createComplianceMountTool, createComplianceAuditdTool,
} from "./defense/compliance.js";
import { createSbomGenerateTool, createSbomCveCheckTool } from "./defense/sbom.js";
import { parseTarget, SshSession, targetHost } from "./transport.js";
import { setRemoteExec } from "./execContext.js";
import { setStealthConfig, stealthDelay } from "./stealth.js";
import { runProfiler } from "./profiler.js";

function isSshTarget(target: string): boolean {
  return target.includes("@")
    || (!target.startsWith(".") && !target.startsWith("/") && target.includes("."));
}

/**
 * Run a defense-mode security assessment against a target.
 *
 * @param target    - SSH target (user@host[:port]) or local path (./path)
 * @param config    - Ananse configuration
 * @param opts      - { harden?: boolean; monitor?: boolean; stealth?: boolean }
 * @param outputPath - Optional file path to write the report
 */
export async function runDefend(
  target: string,
  config: AnanseConfig,
  opts: { harden?: boolean; monitor?: boolean; stealth?: boolean },
  outputPath?: string,
): Promise<void> {
  if (!config.apiKey) {
    console.error(picocolors.red("Error: No API key found."));
    return;
  }

  const model = createModelFromConfig(config, "defense");
  if (!model) {
    console.error(picocolors.red(`Error: Unknown provider "${config.provider}".`));
    return;
  }

  const personality = await loadPersonality();
  const personalitySection = personality ? `\nProject context:\n${personality}` : "";
  const isRemote = isSshTarget(target);
  const onlyMonitor = opts.monitor && !opts.harden;
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
  };

  if (isRemote) {
    // System-level defense tools — only for remote targets
    Object.assign(tools, {
      monitor_fim_snapshot: createMonitorFimSnapshotTool(),
      monitor_fim_check: createMonitorFimCheckTool(),
      monitor_rootkit: createMonitorRootkitTool(),
      monitor_processes: createMonitorProcessesTool(),
      sbom_generate: createSbomGenerateTool(),
      sbom_cve_check: createSbomCveCheckTool(),
    });

    if (!onlyMonitor) {
      Object.assign(tools, {
        compliance_ssh: createComplianceSshTool(),
        compliance_password: createCompliancePasswordTool(),
        compliance_mount: createComplianceMountTool(),
        compliance_auditd: createComplianceAuditdTool(),
      });
    }
  }

  const scopeHint = isRemote
    ? `Remote target: ${targetLabel} (SSH — system-level assessment)`
    : `Local path: ${target} (codebase audit)`;
  const typeHint = onlyMonitor ? "monitoring only" : opts.harden ? "full hardening assessment" : "standard defense assessment";

  const steps = onlyMonitor ? 12 : 20;

  const agent = new ToolLoopAgent({
    model,
    instructions: [
      "You are Ananse, operating in DEFENSE mode — a security engineer with a blue-team mindset.",
      "",
      scopeHint,
      `Assessment type: ${typeHint}`,
      "",
      isRemote
        ? "Work through these phases systematically:"
        : "Audit the codebase for security issues from a defensive perspective:",
      ...(isRemote
        ? [
          ...(onlyMonitor
            ? [
              "1. MONITORING — check for rootkits, analyze process chains",
              "2. FILE INTEGRITY — take a FIM snapshot of critical files",
              "3. SUMMARY — report any signs of compromise or anomalies",
            ]
            : [
              "1. MONITORING — rootkit detection, process chain analysis",
              "2. FILE INTEGRITY — snapshot critical file hashes and check for tampering",
              "3. COMPLIANCE — check SSH config, password policy, mount options, auditd rules",
              "4. SBOM — generate software bill of materials and check for CVEs",
              "5. SUMMARY — prioritize findings and recommend remediations",
            ]),
        ]
        : [
          "1. Scan for hardcoded secrets and exposed credentials",
          "2. Check for OWASP Top 10 vulnerability patterns",
          "3. Review file permissions and sensitive data exposure",
          "4. Report findings with remediation steps",
        ]),
      "",
      "Rules:",
      "- Use the dedicated monitoring and compliance tools where available.",
      "- Do NOT modify any files — this is a read-only assessment.",
      "- Report every finding with severity: CRITICAL, HIGH, MEDIUM, or LOW.",
      "- Include specific recommendations for each finding.",
      ...(onlyMonitor
        ? ["", "Scope limited to monitoring and integrity checks only."]
        : []),
      ...(stealth && profileContext
        ? ["", profileContext]
        : []),
      ...(stealth && !profileContext
        ? ["", "STEALTH MODE: Avoid sudo commands, auditd interaction, and sensitive file reads. Run quietly."]
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

  const actionLabel = onlyMonitor ? "monitoring scan" : opts.harden ? "full hardening assessment" : "defense assessment";
  console.log(picocolors.cyan(`\n  Running ${actionLabel} on ${picocolors.white(targetLabel)}...`));
  console.log(picocolors.dim(`  (read-only — up to ${steps} steps)\n`));

  try {
    if (stealth) await stealthDelay();
    const result = await agent.generate({
      prompt: `Run a ${typeHint} against ${targetLabel}. Be thorough and report ALL findings with severity levels.`,
    });

    const report = result.text ?? "(no findings)";

    console.log("\n" + picocolors.cyan(`╭── Defense Report: ${targetLabel} ────────────────────`));
    console.log(report);
    console.log(picocolors.cyan("└──────────────────────────────────────────────────────────"));

    if (outputPath) {
      await writeFile(outputPath, report, "utf-8");
      console.log(picocolors.green(`\n  Report written to ${picocolors.white(outputPath)}`));
    }
  } catch (error) {
    console.error(
      picocolors.red(`\nDefense error: ${error instanceof Error ? error.message : String(error)}`),
    );
  } finally {
    setRemoteExec(null);
    if (sshSession) await sshSession.close().catch(() => {});
  }
}
