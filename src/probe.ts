import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";
import { writeFile } from "node:fs/promises";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import {
  createReadTool,
  createSearchTool,
  createCrawlTool,
} from "./tools.js";

/**
 * Run a security probe (vulnerability scan) using ToolLoopAgent.
 * Uses read-only tools to scan the project for vulnerabilities.
 */
export async function runProbe(
  target: string | undefined,
  config: AnanseConfig,
  outputPath?: string,
): Promise<void> {
  if (!config.apiKey) {
    console.error(picocolors.red("Error: No API key found."));
    return;
  }

  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red(`Error: Unknown provider "${config.provider}".`));
    return;
  }

  const personality = await loadPersonality();
  const personalitySection = personality
    ? `\nProject context:\n${personality}`
    : "";

  const scopeSection = target
    ? `Scope limited to: ${target}`
    : "Scan the full project.";

  const agent = new ToolLoopAgent({
    model,
    instructions: [
      "You are Ananse, a security auditor. Scan the project for security vulnerabilities.",
      "",
      "Focus on:",
      "- OWASP Top 10 (injection, broken auth, XSS, path traversal, etc.)",
      "- Hardcoded secrets and API keys",
      "- Command injection risks",
      "- Insecure cryptographic usage",
      "- Missing input validation",
      "- Race conditions and TOCTOU issues",
      "",
      "Rules:",
      "- Use read/search/crawl tools to examine the codebase.",
      "- Do NOT modify any files.",
      "- For each finding, report: vulnerability type, affected file(s), severity, description, and remediation.",
      "- Be thorough but avoid false positives.",
      "- Summarize the overall security posture at the end.",
      "",
      scopeSection,
      personalitySection,
    ].filter(Boolean).join("\n"),
    tools: {
      read: createReadTool(),
      search: createSearchTool(),
      crawl: createCrawlTool(),
    },
    stopWhen: stepCountIs(15),
    onStepFinish: (step) => {
      for (const call of step.toolCalls) {
        const args = JSON.stringify(call.input);
        console.log(picocolors.dim(`  → ${call.toolName}${args.length > 2 ? " " + args.slice(0, 100) : ""}`));
      }
    },
  });

  console.log(picocolors.cyan(`\n  Probing for vulnerabilities${target ? `: ${picocolors.dim(target)}` : "..."}`));
  console.log(picocolors.dim("  (read-only audit — up to 15 steps)\n"));

  try {
    const result = await agent.generate({
      prompt: target
        ? `Conduct a security audit of ${target}. Report all findings with severity levels (CRITICAL/HIGH/MEDIUM/LOW).`
        : "Conduct a full-project security audit. Report all findings with severity levels (CRITICAL/HIGH/MEDIUM/LOW).",
    });

    const report = result.text ?? "(no findings)";

    console.log("\n" + picocolors.cyan("╭── Security Report ─────────────────────────────"));
    console.log(report);
    console.log(picocolors.cyan("└──────────────────────────────────────────────────"));

    if (outputPath) {
      await writeFile(outputPath, report, "utf-8");
      console.log(picocolors.green(`\n  Report written to ${picocolors.white(outputPath)}`));
    }
  } catch (error) {
    console.error(
      picocolors.red(`\nProbe scan error: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
