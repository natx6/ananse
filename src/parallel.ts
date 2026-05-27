import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import picocolors from "picocolors";
import type { LanguageModel } from "ai";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
  createSearchTool,
  createCrawlTool,
} from "./tools.js";

export interface AgentTask {
  name: string;
  goal: string;
  allowedTools?: Array<"read" | "write" | "edit" | "command" | "search" | "crawl">;
  maxSteps?: number;
}

export interface ParallelResult {
  name: string;
  text: string;
  success: boolean;
  error?: string;
}

const toolFactories: Record<string, () => unknown> = {
  read: createReadTool,
  write: createWriteTool,
  edit: createEditTool,
  command: createCommandTool,
  search: createSearchTool,
  crawl: createCrawlTool,
};

/**
 * Run multiple sub-agents in parallel, each with their own goal and tool set.
 * Results are streamed in labeled sections and returned as an array.
 */
export async function runParallel(
  model: LanguageModel,
  tasks: AgentTask[],
): Promise<ParallelResult[]> {
  const promises = tasks.map((task) =>
    runSingleAgent(model, task)
  );

  const results = await Promise.allSettled(promises);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      name: tasks[i].name,
      text: "",
      success: false,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

async function runSingleAgent(
  model: LanguageModel,
  task: AgentTask,
): Promise<ParallelResult> {
  const tools: Record<string, unknown> = {};
  const allowedTools = task.allowedTools ?? ["read", "search"];

  for (const name of allowedTools) {
    const factory = toolFactories[name];
    if (factory) tools[name] = factory();
  }

  const system = [
    "You are a focused sub-agent running in parallel with other agents.",
    `Your task: ${task.goal}`,
    "",
    "Be direct and efficient. Report your findings when complete.",
  ].join("\n");

  console.log(picocolors.dim(`  ┌─ [${task.name}] ───────────────────────────`));

  const result = await streamText({
    model,
    system,
    messages: [{ role: "user", content: task.goal }],
    tools: tools as any,
    stopWhen: stepCountIs(task.maxSteps ?? 10),
  });

  let text = "";
  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        process.stdout.write(picocolors.dim(event.text));
        text += event.text;
        break;
      case "tool-call": {
        const input = event.input as Record<string, unknown>;
        const target = input?.path ?? input?.command ?? input?.pattern ?? "";
        console.log(picocolors.dim(`\n  │ [${task.name}] ${event.toolName}: ${String(target).slice(0, 60)}`));
        break;
      }
      case "error":
        console.error(picocolors.red(`\n  │ [${task.name}] Error: ${String(event.error)}`));
        break;
    }
  }

  console.log(picocolors.dim(`  └──────────────────────────────────────────`));

  return {
    name: task.name,
    text: text.trim() || "(no output)",
    success: true,
  };
}

/**
 * Create the parallel_execute tool for the agent.
 */
export function createParallelTool(model: LanguageModel) {
  return tool({
    description: "Run multiple sub-agents in parallel to accomplish independent tasks simultaneously. Use for tasks that don't depend on each other.",
    inputSchema: z.object({
      tasks: z.array(z.object({
        name: z.string().describe("Name for this sub-agent (e.g., 'recon', 'scan')"),
        goal: z.string().describe("The task this sub-agent must accomplish"),
        allowedTools: z.array(z.enum(["read", "write", "edit", "command", "search", "crawl"])).optional()
          .describe("Tools the sub-agent may use"),
        maxSteps: z.number().int().min(1).max(25).optional()
          .describe("Maximum tool-use steps"),
      })).min(1).max(5).describe("Array of tasks to run in parallel (1-5)"),
    }),
    execute: async (input): Promise<ToolResult> => {
      const tasks = (input as { tasks: AgentTask[] }).tasks;
      try {
        const results = await runParallel(model, tasks);
        const summary = results.map(
          (r) => `[${r.name}] ${r.success ? "OK" : "FAIL"}: ${r.text.slice(0, 200)}`,
        ).join("\n");
        return { success: true, data: summary };
      } catch (err) {
        return { success: false, data: "", error: (err as Error).message };
      }
    },
  });
}

registerTool("parallel_execute", "core");
