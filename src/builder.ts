import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
} from "./tools.js";

/**
 * Run a self-correcting build loop using ToolLoopAgent.
 * Executes the build command, detects errors, fixes code, and retries
 * up to N steps.
 */
export async function runBuildLoop(
  buildCommand: string,
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
      "You are Ananse, an autonomous build-fixing agent.",
      "Your task: run the given build command, examine any errors, and fix them.",
      "",
      "Rules:",
      "- First run the build command to see if it passes.",
      "- If it fails, read the relevant source files, understand the error, and apply fixes.",
      "- Run the build command again after fixing.",
      "- Repeat until the build succeeds or you hit the step limit.",
      "- When the build succeeds, announce it clearly.",
      "- Be surgical with your fixes — change only what's needed.",
      personalitySection,
    ].filter(Boolean).join("\n"),
    tools: {
      read: createReadTool(),
      write: createWriteTool(),
      edit: createEditTool(),
      command: createCommandTool(),
    },
    stopWhen: stepCountIs(10),
  });

  console.log(picocolors.cyan(`\n  Building: ${picocolors.dim(buildCommand)}`));
  console.log(picocolors.dim("  (automatic fix loop — up to 10 steps)\n"));

  try {
    const result = await agent.generate({
      prompt: `Run this build command and fix any errors: ${buildCommand}`,
    });

    console.log("");
    console.log(picocolors.dim("─── Build Result ───"));
    console.log(result.text ?? "(no output)");
  } catch (error) {
    console.error(
      picocolors.red(`\nBuild loop error: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
