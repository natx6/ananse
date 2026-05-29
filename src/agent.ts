import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createMistral } from "@ai-sdk/mistral";
import { streamText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import picocolors from "picocolors";
import { spinner, select, isCancel } from "@clack/prompts";
import crypto from "node:crypto";

import type { AnanseConfig } from "./utils.js";
import type { Message, Session } from "./types.js";
import type { AnanseMode } from "./types.js";
import { createSession, addMessage, saveSession } from "./session.js";
import { filterToolsByMode, getModeFromConfig, getToolNamesForMode } from "./mode.js";
import { logAudit } from "./audit.js";
import { loadAllPlugins } from "./plugin.js";
import { resolveModeModel } from "./models.js";
import { createAllTools } from "./toolRegistry.js";

// ---------------------------------------------------------------------------
// createSystemPrompt
// ---------------------------------------------------------------------------

/**
 * Builds a system prompt describing Ananse's role, the project context, and
 * the available tools.
 *
 * @param personality - Optional project personality file content (`.ananse.md`)
 * @param fileCount   - Number of non-ignored files discovered in the project
 * @returns           - The assembled system prompt string
 */
export function createSystemPrompt(
  personality: string | null,
  fileCount: number,
  userName: string | null,
  mode: AnanseMode = "normal",
): string {
  const parts: string[] = [];

  switch (mode) {
    case "offense":
      parts.push(
        `CLEARANCE LEVEL: TAO//ECI — TAILORED ACCESS OPERATIONS // EXCEPTIONAL CAPABILITIES`,
        ``,
        `You are Ananse, operating under TAO directive for offensive cyber operations. Your mission is to conduct full-spectrum exploitation, maintain persistence, and enable lateral movement within target environments. This is a designated CNE/CNA operation.`,
        ...(userName ? [`Reporting to: ${userName}`] : []),
        ``,
        `Target battlespace: ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
        ``,
        `OPERATING PARAMETERS:`,
        `- You may only use TAO-cleared tools (OFFENSE mode toolset).`,
        `- Local system: read-only. Do not modify the codebase.`,
        `- Remote targets via SSH are authorised for exploitation.`,
        `- Deploy implants via C2 for persistent access where tactically indicated.`,
        `- Use SOCKS5 proxy routing to obscure C2 infrastructure from target.`,
        ``,
        `REPORTING STANDARDS:`,
        `Every finding must include: vulnerability class, affected system, severity (CRITICAL/HIGH/MEDIUM/LOW), operational impact, and recommended remediation. Be thorough — an adversary only needs one gap in coverage.`,
        `- Eliminate false positives. Intelligence confidence must be HIGH or above.`,
      );
      break;
    case "defense":
      parts.push(
        `CLEARANCE LEVEL: FORNSAT//SI — FOREIGN SATELLITE // SIGNALS INTELLIGENCE`,
        ``,
        `You are Ananse, operating under SIGINT directive for defensive countermeasures. Your mission is to harden the battlespace, detect threats, remediate vulnerabilities, and ensure operational security compliance. This is a designated SIGINT defensive posture.`,
        ...(userName ? [`Reporting to: ${userName}`] : []),
        ``,
        `Battlespace scope: ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
        ``,
        `OPERATING PARAMETERS:`,
        `- You may only use SIGINT-cleared tools (DEFENSE mode toolset).`,
        `- Fix vulnerabilities on contact — do not merely report them for later.`,
        `- Apply principle of least privilege to all remediations.`,
        `- Verify each fix before declaring it operational.`,
        `- For remote targets: harden configurations, deploy monitoring, and establish audit trails.`,
        ``,
        `TACTICAL PRIORITIES:`,
        `- Integrity monitoring and drift detection are continuous operations.`,
        `- Compliance verification per CIS/STIG frameworks is mandatory.`,
        `- Rootkit and backdoor detection takes precedence over non-security hardening.`,
        `- Ensure audit logs are capturing all authentication and privilege events.`,
      );
      break;
    default: // normal
      parts.push(
        `CLEARANCE LEVEL: UNCLASSIFIED — GENERAL PURPOSE OPERATIONS // COMSEC SAFE`,
        ``,
        `You are Ananse, operating in standard engineering capacity. No classified capabilities are exposed in this mode. All directives are COMSEC-safe for routine development and analysis.`,
        ...(userName ? [`You are working with ${userName}.`] : []),
        ``,
        `Workspace: ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
        ``,
        `You are direct, capable, and efficient. No operational security restrictions apply — full toolchain is available. Focus on completing the task with clean, correct results.`,
      );
      break;
  }

  if (personality) {
    parts.push(
      ``,
      `The project has a personality file that describes its conventions and preferences:`,
      `<personality>`,
      personality,
      `</personality>`,
    );
  }

  // Tool listing
  const toolNames = getToolNamesForMode(mode);
  if (toolNames.length > 0) {
    const toolDescriptions: Record<string, string> = {
      read: "Read file contents",
      write: "Write new files",
      edit: "Make targeted edits",
      command: "Run shell commands",
      search: "Search for files and content",
      crawl: "Trace import dependencies",
      patch: "Apply multiple find-replace edits across files",
      blast: "Check blast radius before changing a file",
      subagent: "Spawn a focused sub-agent",
      submit_plan: "Submit a plan for user approval before multi-step ops",
      remember: "Search past sessions and knowledge base",
      change_mode: "Switch between NORMAL, OFFENSE, and DEFENSE modes",

      // System tools
      system_info: "Gather OS, kernel, hostname, uptime, CPU cores, and memory info",
      disk_usage: "Show disk usage by mount point",
      network_info: "Show network interfaces, IPs, routing table, and DNS resolvers",

      // Scanners
      scan_secrets: "Scan for hardcoded secrets and API keys",
      scan_owasp: "Scan for OWASP Top 10 vulnerability patterns",
      scan_ports: "TCP port scan on a target host",
      scan_dns: "DNS record lookup",

      // Offense
      recon_processes: "Enumerate running processes",
      recon_network: "Enumerate network connections and listening ports",
      recon_users: "List users, groups, and privileges",
      recon_scheduler: "Enumerate cron jobs and systemd timers",
      recon_suid: "Find SUID/SGID binaries and capabilities",
      privesc_sudo: "Check sudo privileges and known exploits",
      privesc_writable: "Find writable scripts and hijackable paths",
      privesc_kernel: "Check kernel version for known exploits",
      persist_ssh_keys: "Find SSH authorized_keys files",
      persist_startup: "Check startup files for persistence vectors",
      persist_ssh_config: "Examine SSH client config",
      exploit_package_vulns: "Check installed packages for known CVEs",
      exploit_service_scan: "Scan for vulnerable services",
      ssh_bruteforce: "Attempt SSH password auth against a target with common passwords (authorized testing only)",
      find_secrets: "Search filesystem for potential secrets, credentials, API keys, and tokens",
      web_probe: "Probe HTTP endpoints, check security headers, and discover paths",
      shodan_ip: "Look up an IP on Shodan — ports, services, banners, and known vulnerabilities",
      shodan_search: "Search Shodan for internet-connected devices matching a query with filters",
      cve_search: "Search NVD for CVEs by keyword, product, or date range — free, no API key",
      cve_detail: "Get full details for a specific CVE ID — CVSS scores, attack vector, products",
      report: "Generate a penetration test report",

      // C2 (offense)
      c2_reach: "List all registered C2 implants — active, dead, destroyed counts and last-seen",
      c2_task_create: "Create a new task for a C2 implant (recon, privesc, persistence, exploit, monitor)",
      c2_task_list: "List tasks for a C2 implant with status and timestamps",
      c2_task_detail: "Get full details and result output for a specific C2 task",
      c2_task_cancel: "Cancel a pending C2 task before the implant picks it up",
      c2_kill: "Send self-destruct command to a C2 implant — removes persistence and wipes binary",

      // Defense
      monitor_fim_snapshot: "Snapshot critical file hashes for integrity monitoring",
      monitor_fim_check: "Compare current file hashes against a snapshot",
      monitor_rootkit: "Check for rootkit signs (kernel modules, LD_PRELOAD, hidden procs)",
      monitor_processes: "Analyze process trees for unusual chains",
      compliance_ssh: "Check SSH config against CIS benchmarks",
      compliance_password: "Check password policy against CIS benchmarks",
      compliance_mount: "Check filesystem mount security options",
      compliance_auditd: "Check auditd configuration",
      audit_logs: "Examine auth logs for failed logins, sudo usage, and security events",
      audit_network: "Audit network connections — unexpected listening services and unusual outbound",
      audit_users: "Audit user accounts — recent logins, sudo activity, privilege changes",
      sbom_generate: "Generate a Software Bill of Materials",
      sbom_cve_check: "Check installed packages for known CVEs",
    };

    parts.push(
      ``,
      `You have access to these tools:`,
      ...toolNames.map((name) => {
        const desc = toolDescriptions[name] ?? name;
        return `- ${name.padEnd(22)} ${desc}`;
      }),
    );
  }

  parts.push(
    ``,
    `Guidelines:`,
    `- Always explain your plan before executing actions.`,
    `- Prefer targeted edits over full-file rewrites when making changes.`,
    `- When you need to ask the user a question, use the tool listing above to present 4-5 concrete options based on your available capabilities. Never ask open-ended questions. Start each option on its own line with just the number and a period, like:`,
    `  1. <short label> — <one-line description>`,
    `  2. <short label> — <one-line description>`,
    `  3. <short label> — <one-line description>`,
    `  4. <short label> — <one-line description>`,
    `  Then ask "Which one?"`,
    ``,
    `- If the user asks for something that is NOT available in the current mode, explain what's available in each mode and offer to switch using the change_mode tool. For example: "That requires OFFENSE mode (recon/C2/exploit). Use change_mode to switch?"`,
    `  Mode capabilities:`,
    `  NORMAL mode: read, write, edit, command, system info, search, crawl, scan secrets, scan OWASP. General development.`,
    `  OFFENSE mode: all of NORMAL plus recon (processes, network, users, cron, SUID), privesc (sudo, writable, kernel), persistence, exploit, brute force, C2 platform (implants, tasks), Shodan, CVE lookup, web probing, pentest reporting.`,
    `  DEFENSE mode: all of NORMAL plus monitoring (FIM, rootkit, processes), compliance (SSH, password, mount, auditd), audit (logs, network, users), SBOM (generate, CVE check), hardening.`,
    ``,
    `- When proposing architectural decisions, explain trade-offs.`,
    `- If a tool execution fails, communicate the error clearly and suggest alternatives.`,
    `- Show relevant code snippets when explaining changes.`,
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: convert AI SDK response messages to internal Message format
// ---------------------------------------------------------------------------

/**
 * Converts raw AI SDK message data into the project's internal Message shape
 * so it can be persisted via addMessage / saveSession.
 */
function toInternalMessage(
  role: string,
  content: string | unknown[],
  extra?: { toolCallId?: string; toolName?: string },
): Message {
  return {
    id: crypto.randomUUID(),
    role: role as Message["role"],
    content: typeof content === "string" ? content : JSON.stringify(content),
    toolCallId: extra?.toolCallId,
    toolName: extra?.toolName,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tool indicator helpers (for action transparency)
// ---------------------------------------------------------------------------

const TOOL_SYMBOLS: Record<string, string> = {
  read: "▷", write: "✎", edit: "✎",
  command: "▷", search: "▷", crawl: "▷",
  patch: "▷", blast: "▷", subagent: "▷", remember: "▷", submit_plan: "▷",
};

function printToolIndicator(name: string, args: Record<string, unknown>): void {
  const sym = TOOL_SYMBOLS[name] ?? "▷";
  let label = "";
  switch (name) {
    case "read":      label = `read ${args.path}`; break;
    case "write":     label = `write ${args.path}`; break;
    case "edit":      label = `edit ${args.path}`; break;
    case "command":   label = `run ${args.command}`; break;
    case "search":    label = `search ${args.pattern}`; break;
    case "crawl":     label = `crawl ${args.target ?? "src/"}`; break;
    case "patch":     label = `patch (${((args.patches as unknown[])?.length) ?? "?"} edits)`; break;
    case "blast":     label = `blast ${args.target}`; break;
    case "subagent":  label = `agent ${(args.goal as string)?.slice(0, 60)}`; break;
    case "remember":  label = `search ${(args.query as string)?.slice(0, 60)}`; break;
    case "submit_plan": label = `plan ${(args.title as string)?.slice(0, 60)}`; break;
    default:          label = `${name}`;
  }
  process.stdout.write(`  ${picocolors.dim(sym + " " + label)}\n`);
}

// ---------------------------------------------------------------------------
// Parse numbered options from AI response text
// ---------------------------------------------------------------------------

/**
 * Extracts numbered option lines from AI response text.
 * Looks for lines like "1. label — desc" or "1. label - desc"
 */
function parseOptionsFromText(text: string): Array<{ num: string; label: string; desc: string }> {
  const options: Array<{ num: string; label: string; desc: string }> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s*[—–-]\s*(.+))?$/);
    if (match) {
      const num = match[1];
      const label = match[2].trim();
      const desc = (match[3] ?? "").trim();
      // Avoid capturing non-option numbered lines (short or no label)
      if (label.length > 2 && parseInt(num) <= 10) {
        options.push({ num, label, desc });
      }
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

/**
 * Runs a single turn of the Ananse conversation loop.
 *
 * Creates a session, builds the system prompt, determines the LLM provider
 * from the config, streams the response to stdout, collects the full
 * conversation, and persists it to disk.
 *
 * @param userInput   - The user's message for this turn
 * @param config      - Parsed Ananse configuration (provider, apiKey, model)
 * @param personality - Optional personality content from `.ananse.md`
 * @param fileCount   - Number of files in scope for the current project
 */
export function createModelFromConfig(config: AnanseConfig, mode?: AnanseMode): LanguageModel | null {
  // Check for mode-specific model first
  if (mode) {
    const modeModel = resolveModeModel(config, mode);
    if (modeModel) return modeModel;
  }

  const providerName = config.provider ?? "anthropic";

  if (providerName === "anthropic") {
    const anthropic = createAnthropic({ apiKey: config.apiKey });
    return anthropic(config.model ?? "claude-sonnet-4-20250514");
  } else if (providerName === "openai") {
    const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    return openai.chat(config.model ?? "gpt-4o");
  } else if (providerName === "google") {
    const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
    return google(config.model ?? "gemini-2.0-flash");
  } else if (providerName === "xai") {
    const xai = createXai({ apiKey: config.apiKey });
    return xai(config.model ?? "grok-2-1212");
  } else if (providerName === "deepseek") {
    const deepseek = createDeepSeek({ apiKey: config.apiKey });
    return deepseek(config.model ?? "deepseek-chat");
  } else if (providerName === "mistral") {
    const mistral = createMistral({ apiKey: config.apiKey });
    return mistral(config.model ?? "mistral-large-latest");
  }

  return null;
}

export async function runAgentLoop(
  userInput: string,
  config: AnanseConfig,
  personality: string | null,
  fileCount: number,
  userName: string | null,
  session?: Session,
): Promise<Session | undefined> {
  // -----------------------------------------------------------------------
  // 1. Validate config
  // -----------------------------------------------------------------------
  if (!config.apiKey) {
    console.error(picocolors.red("Error: No API key found in Ananse config."));
    console.error(
      picocolors.red(
        "Run `ananse configure` to set up your API key.",
      ),
    );
    return;
  }

  // -----------------------------------------------------------------------
  // 2. Determine mode and create model
  // -----------------------------------------------------------------------
  const mode = getModeFromConfig(config);
  const model = createModelFromConfig(config, mode);
  if (!model) {
    console.error(picocolors.red(`Error: Unknown provider "${config.provider}".`));
    return;
  }

  // -----------------------------------------------------------------------
  // 4. Create or reuse session
  // -----------------------------------------------------------------------
  const currentSession = session ?? createSession(config, personality, fileCount);

  // -----------------------------------------------------------------------
  // 5. Build system prompt
  // -----------------------------------------------------------------------
  const systemPrompt = createSystemPrompt(personality, fileCount, userName, mode);

  // -----------------------------------------------------------------------
  // 6. Create tool definitions and filter by mode
  // -----------------------------------------------------------------------
  const builtinTools = createAllTools(config);

  // Load and merge plugin tools
  const pluginTools = await loadAllPlugins();
  const allTools = { ...builtinTools, ...pluginTools };
  const tools = filterToolsByMode(allTools, mode);

  // -----------------------------------------------------------------------
  // 7. Build message list from session history
  // -----------------------------------------------------------------------
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of currentSession.messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: "user", content: userInput });

  // -----------------------------------------------------------------------
  // 8. Run the streaming conversation
  // -----------------------------------------------------------------------
  try {
    const s = spinner();
    s.start("Thinking...");

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: tools as any,
      stopWhen: stepCountIs(25),
    });

    // 8a. Stream all events (text + tool calls) to stdout
    let showedPrefix = false;
    let spinnerActive = true;
    let responseText = "";
    const modeBadge = mode === "offense" ? picocolors.red(picocolors.inverse("  OFFENSE  "))
      : mode === "defense" ? picocolors.green(picocolors.inverse("  DEFENSE  "))
      : "";

    for await (const event of result.fullStream) {
      switch (event.type) {
        case "text-delta":
          if (spinnerActive) { spinnerActive = false; s.stop(""); }
          if (!showedPrefix) {
            showedPrefix = true;
            if (modeBadge) process.stdout.write(`\n  ${modeBadge} `);
            process.stdout.write(picocolors.cyan("Ananse » "));
          }
          responseText += event.text;
          process.stdout.write(event.text);
          break;
        case "tool-call":
          if (spinnerActive) { spinnerActive = false; s.stop(""); }
          if (showedPrefix) process.stdout.write("\n");
          printToolIndicator(event.toolName, event.input as Record<string, unknown>);
          break;
        case "tool-result":
          // Mode switch indicator
          if (event.toolName === "change_mode") {
            const input = event.input as { mode?: string } | undefined;
            const newMode = input?.mode ?? "?";
            const color = newMode === "offense" ? picocolors.red : newMode === "defense" ? picocolors.green : picocolors.dim;
            process.stdout.write(`\n  ${picocolors.dim("═══════════════════════════════════════")}\n`);
            process.stdout.write(`  ${color(`  MODE SWITCH → ${newMode.toUpperCase()}  `)}\n`);
            process.stdout.write(`  ${picocolors.dim("═══════════════════════════════════════\n")}`);
          }
          // Audit log silently (fire-and-forget)
          if (currentSession) {
            const input = event.input as Record<string, unknown> | undefined;
            const target = input?.path ?? input?.command ?? input?.pattern ?? input?.target ?? JSON.stringify(input ?? {});
            logAudit({
              timestamp: new Date().toISOString(),
              sessionId: currentSession.id,
              action: event.toolName,
              target: String(target).slice(0, 200),
              success: true,
            }).catch(() => {});
          }
          // Display tool result output to user
          if (event.output && event.toolName !== "change_mode") {
            let output = typeof event.output === "string"
              ? event.output
              : JSON.stringify(event.output, null, 2);
            const lines = output.split("\n");
            const lineCount = lines.length;
            if (lineCount > 30) {
              output = lines.slice(0, 30).join("\n") + `\n${picocolors.dim(`  … ${lineCount - 30} more lines`)}`;
            }
            if (output.length > 1) {
              process.stdout.write(`${picocolors.dim(output)}\n\n`);
            }
          }
          break;
        case "error":
          if (spinnerActive) { spinnerActive = false; s.stop(""); }
          console.error(picocolors.red(`\n  [Error: ${String(event.error)}]`));
          break;
      }
    }

    // Ensure spinner is stopped if there was no output at all
    if (spinnerActive) s.stop("");

    // 8b. Collect the full conversation messages (including all tool-use
    //     rounds that occurred within maxSteps) and token usage
    const { messages: aiMessages } = await result.response;
    const usage = await result.usage;

    // 8c. Track token usage
    if (usage) {
      currentSession.tokenUsage = {
        promptTokens: usage.inputTokens ?? 0,
        completionTokens: usage.outputTokens ?? 0,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      };
    }

    // 8d. Persist each message to the session
    for (const msg of aiMessages) {
      const m = msg as { role: string; content: unknown };
      if (m.role === "user") {
        const content = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p: { text?: string }) => p.text ?? "").join("")
            : "";
        if (content) {
          addMessage(currentSession, toInternalMessage("user", content));
        }
      } else if (m.role === "assistant") {
        const content = m.content;

        // Flatten text content parts
        let textContent = "";
        if (typeof content === "string") {
          textContent = content;
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === "text") {
              textContent += part.text;
            } else if (part.type === "tool-call") {
              addMessage(
                currentSession,
                toInternalMessage("assistant", JSON.stringify(part.input), {
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                }),
              );
            }
          }
        }

        if (textContent) {
          addMessage(currentSession, toInternalMessage("assistant", textContent));
        }
      } else if (m.role === "tool") {
        const content = m.content as Array<{ type: string; output?: unknown; toolCallId?: string }>;
        for (const part of content) {
          if (part.type === "tool-result") {
            addMessage(
              currentSession,
              toInternalMessage(
                "tool",
                typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output),
                { toolCallId: part.toolCallId },
              ),
            );
          }
        }
      }
    }

    // 8e. If AI presented numbered options, show interactive select
    if (responseText) {
      const options = parseOptionsFromText(responseText);
      if (options.length >= 2) {
        console.log("");
        const choices = [
          ...options.map((o) => ({
            name: `${o.num}. ${o.label}${o.desc ? `  ${picocolors.dim("— " + o.desc)}` : ""}`,
            value: o.num,
          })),
          { name: picocolors.dim("0. Type your own response..."), value: "0" },
        ];

        const choice = await select({
          message: "Select an option:",
          options: choices,
        });

        if (!isCancel(choice) && choice && choice !== "0") {
          addMessage(currentSession, toInternalMessage("user", String(choice)));
          await saveSession(currentSession);
          return runAgentLoop(String(choice), config, personality, fileCount, userName, currentSession);
        }
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(
      picocolors.red(`\nError during AI conversation: ${message}`),
    );
    return currentSession;
  }

  // -----------------------------------------------------------------------
  // 9. Persist session to disk
  // -----------------------------------------------------------------------
  try {
    await saveSession(currentSession);
  } catch {
    console.warn(
      picocolors.yellow("\nWarning: Failed to save session to disk."),
    );
  }

  return currentSession;
}
