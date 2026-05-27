import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";

import type { AnanseConfig } from "../utils.js";
import { createModelFromConfig } from "../agent.js";
import { loadPersonality } from "../personality.js";
import { registerTool } from "../mode.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
} from "../tools.js";
import { createBatchEditTool } from "../patch.js";

registerTool("harden", "defense");

/**
 * Run a hardening / fix loop using ToolLoopAgent.
 * Executes any validation command, detects errors, fixes code or system
 * configurations, and retries up to N steps. In defense mode, this is the
 * primary remediation tool.
 */
export async function runHardenLoop(
  validationCommand: string,
  config: AnanseConfig,
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
    ? `\nProject personality (conventions, stack, preferences):\n${personality}`
    : "";

  const agent = new ToolLoopAgent({
    model,
    instructions: [
      "You are Ananse, operating in DEFENSE mode — a security engineer and system hardener.",
      `Your task: run the given validation command, examine errors, and fix them.`,
      "",
      "Rules:",
      `- First run: ${validationCommand}`,
      "- If it fails, read relevant files, understand the errors, and apply fixes.",
      "- Prefer targeted edits or batch patches over full-file rewrites.",
      `- Re-run: ${validationCommand}`,
      "- Repeat until the command succeeds or you hit the step limit.",
      "- When the command succeeds, announce it clearly.",
      "- Be surgical — change only what is needed to fix the error.",
      "- For system-level issues: check configs, permissions, dependencies.",
      personalitySection,
    ].filter(Boolean).join("\n"),
    tools: {
      read: createReadTool(),
      write: createWriteTool(),
      edit: createEditTool(),
      command: createCommandTool(),
      patch: createBatchEditTool(),
    },
    stopWhen: stepCountIs(12),
  });

  console.log(picocolors.cyan(`\n  Hardening: ${picocolors.dim(validationCommand)}`));
  console.log(picocolors.dim("  (defense fix loop — up to 12 steps)\n"));

  try {
    const result = await agent.generate({
      prompt: `Run this command and fix any errors: ${validationCommand}`,
    });

    console.log("");
    console.log(picocolors.dim("─── Hardening Result ───"));
    console.log(result.text ?? "(no output)");
  } catch (error) {
    console.error(
      picocolors.red(`\nHarden loop error: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
