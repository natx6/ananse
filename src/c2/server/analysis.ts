import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { createModelFromConfig } from "../../agent.js";
import type { AnanseConfig } from "../../utils.js";
import type { C2Task } from "../types.js";

/**
 * Run LLM analysis on a completed task result.
 * Non-blocking — fires and forgets, stores analysis into the task's result data.
 * Returns immediately if no model config is available.
 */
export async function analyzeTaskResult(task: C2Task): Promise<void> {
  if (!task.result) return;

  const config = loadAnanseConfig();
  if (!config?.apiKey) return;

  const model = createModelFromConfig(config);
  if (!model) return;

  const prompt = buildAnalysisPrompt(task);

  try {
    const { text } = await generateText({ model, prompt });
    const analysis = text?.trim();
    if (analysis) {
      task.result.analysis = analysis;
    }
  } catch (err) {
    console.error(`[c2] LLM analysis failed for ${task.taskId.slice(0, 8)}: ${(err as Error).message}`);
  }
}

function loadAnanseConfig(): AnanseConfig | null {
  const paths = [
    join(homedir(), ".ananse", "config.json"),
    join(process.cwd(), ".ananse.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as AnanseConfig;
    } catch {
      return null;
    }
  }
  return null;
}

function buildAnalysisPrompt(task: C2Task): string {
  let resultPreview: string;
  if (task.result) {
    resultPreview = task.result.data ?? "";
    if (resultPreview.length > 2000) {
      resultPreview = resultPreview.slice(0, 2000) + "\n...[truncated]";
    }
  } else {
    resultPreview = "(no result data)";
  }

  return [
    `You are a C2 task result analyst. Review the following task output and provide a concise analysis (2-3 sentences).`,
    `Focus on: what was found, any security implications, and whether the result looks normal or suspicious.`,
    ``,
    `Task type: ${task.type}`,
    `Parameters: ${JSON.stringify(task.params)}`,
    `Status: ${task.status}`,
    `Result data:`,
    resultPreview,
    ``,
    `Analysis:`,
  ].join("\n");
}
