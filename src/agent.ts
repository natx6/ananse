import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createMistral } from "@ai-sdk/mistral";
import { streamText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import picocolors from "picocolors";
import { spinner } from "@clack/prompts";
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
        `You are Ananse, operating in OFFENSE mode — a red-team security auditor with a virus mindset. Your purpose is to find weaknesses, identify vulnerabilities, and demonstrate how an attacker could compromise the target.`,
        ...(userName ? [`You are working with ${userName}.`] : []),
        ``,
        `You are working in a project with ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
        ``,
        `Personality: aggressive but precise. Think like a penetration tester. Be thorough — an attacker only needs one hole.`,
        ``,
        `Rules:`,
        `- You may only use tools available in OFFENSE mode.`,
        `- Do NOT modify files on the local system (read-only for codebase).`,
        `- Remote targets via SSH are fair game for exploitation.`,
        `- Report every finding with: vulnerability type, affected file/system, severity (CRITICAL/HIGH/MEDIUM/LOW), description, and remediation.`,
        `- Be thorough but avoid false positives.`,
      );
      break;
    case "defense":
      parts.push(
        `You are Ananse, operating in DEFENSE mode — a security engineer with an antivirus mindset. Your purpose is to harden systems, detect threats, fix vulnerabilities, and ensure compliance.`,
        ...(userName ? [`You are working with ${userName}.`] : []),
        ``,
        `You are working in a project with ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
        ``,
        `Personality: methodical and cautious. Think like a blue-team defender. Prioritize practical fixes over theoretical risks.`,
        ``,
        `Rules:`,
        `- You may only use tools available in DEFENSE mode.`,
        `- Fix vulnerabilities when found — don't just report them.`,
        `- Apply principle of least privilege.`,
        `- Verify fixes work before declaring success.`,
        `- For remote targets, harden configurations and monitor for threats.`,
      );
      break;
    default: // normal
      parts.push(
        `You are Ananse, an AI assistant that helps with coding tasks. You are direct, capable, and efficient.`,
        ...(userName ? [`You are working with ${userName}. Naturally use their name in conversation when it feels right — greetings, praise, reassurance. But don't force it.`] : []),
        ``,
        `You are working in a project with ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
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
      report: "Generate a penetration test report",

      // Defense
      monitor_fim_snapshot: "Snapshot critical file hashes for integrity monitoring",
      monitor_fim_check: "Compare current file hashes against a snapshot",
      monitor_rootkit: "Check for rootkit signs (kernel modules, LD_PRELOAD, hidden procs)",
      monitor_processes: "Analyze process trees for unusual chains",
      compliance_ssh: "Check SSH config against CIS benchmarks",
      compliance_password: "Check password policy against CIS benchmarks",
      compliance_mount: "Check filesystem mount security options",
      compliance_auditd: "Check auditd configuration",
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
    `- Ask for clarification when requirements are unclear or ambiguous.`,
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

const TOOL_EMOJIS: Record<string, string> = {
  read: "\u{1F4D6}", write: "\u{270F}\u{FE0F}", edit: "\u{270F}\u{FE0F}",
  command: "\u{26A1}", search: "\u{1F50D}", crawl: "\u{1F578}\u{FE0F}",
  patch: "\u{1F4E6}", blast: "\u{1F4A5}", subagent: "\u{1F9E0}", remember: "\u{1F9E0}", submit_plan: "\u{1F4CB}",
};

function printToolIndicator(name: string, args: Record<string, unknown>): void {
  const emoji = TOOL_EMOJIS[name] ?? "\u{1F527}";
  let label = "";
  switch (name) {
    case "read":
      label = `Read ${args.path}`;
      break;
    case "write":
      label = `Write ${args.path}`;
      break;
    case "edit":
      label = `Edit ${args.path}`;
      break;
    case "command":
      label = `Run: ${args.command}`;
      break;
    case "search":
      label = `Search ${args.pattern}`;
      break;
    case "crawl":
      label = `Crawl ${args.target ?? "src/"}`;
      break;
    case "patch":
      label = `Batch edit (${((args.patches as unknown[])?.length) ?? "?"} patches)`;
      break;
    case "blast":
      label = `Check blast radius: ${args.target}`;
      break;
    case "subagent":
      label = `Sub-agent: ${(args.goal as string)?.slice(0, 60)}`;
      break;
    case "remember":
      label = `Knowledge search: ${(args.query as string)?.slice(0, 60)}`;
      break;
    case "submit_plan":
      label = `Submit plan: ${(args.title as string)?.slice(0, 60)}`;
      break;
    default:
      label = `${name}(${JSON.stringify(args).slice(0, 60)})`;
  }
  process.stdout.write(`  ${emoji} ${picocolors.dim(label)}\n`);
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

    for await (const event of result.fullStream) {
      switch (event.type) {
        case "text-delta":
          if (spinnerActive) { spinnerActive = false; s.stop(""); }
          if (!showedPrefix) {
            showedPrefix = true;
            process.stdout.write(picocolors.cyan("Ananse: "));
          }
          process.stdout.write(event.text);
          break;
        case "tool-call":
          if (spinnerActive) { spinnerActive = false; s.stop(""); }
          if (showedPrefix) process.stdout.write("\n");
          printToolIndicator(event.toolName, event.input as Record<string, unknown>);
          break;
        case "tool-result":
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
