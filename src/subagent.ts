import { tool, streamText, stepCountIs } from "ai";
import { z } from "zod";
import picocolors from "picocolors";
import type { AnanseConfig } from "./utils.js";
import type { ToolResult } from "./types.js";
import { createModelFromConfig } from "./agent.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
  createSearchTool,
  createCrawlTool,
} from "./tools.js";

/**
 * Factory for the sub-agent spawn tool.
 * The conversational agent can use this to delegate a focused task to
 * a sub-agent with its own instructions and limited tool set.
 */
export function createSubAgentTool(config: AnanseConfig) {
  return tool({
    description: `Spawn a sub-agent to accomplish a task independently.
The sub-agent gets its own instructions and tool set.
Use for complex sub-tasks that benefit from focused attention.`,
    inputSchema: z.object({
      goal: z.string().describe("The task the sub-agent must accomplish"),
      allowedTools: z
        .array(z.enum(["read", "write", "edit", "command", "search", "crawl"]))
        .default(["read", "search"])
        .describe("Tools the sub-agent may use"),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(25)
        .default(10)
        .describe("Maximum tool-use steps for the sub-agent"),
      additionalInstructions: z
        .string()
        .optional()
        .describe("Additional instructions or constraints"),
    }),
    execute: async ({
      goal,
      allowedTools,
      maxSteps,
      additionalInstructions,
    }): Promise<ToolResult> => {
      const model = createModelFromConfig(config);
      if (!model) {
        return { success: false, data: "", error: "No valid model from config" };
      }

      // Build tool subset from allowed tools
      const toolMap: Record<string, unknown> = {
        read: createReadTool(),
        write: createWriteTool(),
        edit: createEditTool(),
        command: createCommandTool(),
        search: createSearchTool(),
        crawl: createCrawlTool(),
      };
      const subTools: Record<string, unknown> = {};
      for (const name of allowedTools) {
        if (toolMap[name]) subTools[name] = toolMap[name];
      }

      // Build system prompt
      const systemParts = [
        "You are a focused sub-agent. Your task is limited and specific.",
        "",
        `Goal: ${goal}`,
        "",
        "You have access to these tools: " + allowedTools.join(", "),
        "Be direct and efficient. Report your findings when complete.",
      ];
      if (additionalInstructions) {
        systemParts.push("", `Additional instructions: ${additionalInstructions}`);
      }

      // Run sub-agent, streaming output in a dimmed box
      const result = streamText({
        model,
        system: systemParts.join("\n"),
        messages: [{ role: "user", content: goal }],
        tools: subTools as any,
        stopWhen: stepCountIs(maxSteps),
      });

      let subText = "";
      process.stdout.write(picocolors.dim(`  ┌─ Sub-agent ──────────────────────────────\n`));

      for await (const event of result.fullStream) {
        switch (event.type) {
          case "text-delta":
            process.stdout.write(picocolors.dim(event.text));
            subText += event.text;
            break;
          case "tool-call": {
            const input = event.input as Record<string, unknown>;
            const label = formatToolCall(event.toolName, input);
            process.stdout.write(`\n${picocolors.dim(`  │ ${label}`)}\n`);
            break;
          }
          case "tool-result":
            // silently continue
            break;
          case "error":
            process.stdout.write(picocolors.red(`\n  │ [Error: ${String(event.error)}]\n`));
            break;
        }
      }

      process.stdout.write(picocolors.dim(`\n  └────────────────────────────────────\n`));

      return {
        success: true,
        data: subText.trim() || "(sub-agent completed with no text output)",
      };
    },
  });
}

function formatToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read":
      return `\u{1F4D6} Read ${args.path}`;
    case "write":
      return `\u{270F} Write ${args.path}`;
    case "edit":
      return `\u{270F} Edit ${args.path}`;
    case "command":
      return `\u{26A1} Run: ${args.command}`;
    case "search":
      return `\u{1F50D} Search ${args.pattern}`;
    case "crawl":
      return `\u{1F578} Crawl ${args.target ?? "src/"}`;
    default:
      return `${name}(${JSON.stringify(args).slice(0, 60)})`;
  }
}
