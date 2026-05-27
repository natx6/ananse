import { tool } from "ai";
import { z } from "zod";
import { searchKnowledge } from "./knowledge.js";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

export function createRememberTool() {
  return tool({
    description: "Search past sessions, findings, and notes stored in the knowledge base.",
    inputSchema: z.object({
      query: z.string().describe("Search query for the knowledge base"),
      maxResults: z.number().int().min(1).max(50).optional().describe("Maximum results (default 10)"),
    }),
    execute: async ({ query, maxResults }): Promise<ToolResult> => {
      const results = searchKnowledge(query, maxResults ?? 10);
      if (results.length === 0) {
        return { success: true, data: "No matching entries found in knowledge base." };
      }
      const lines = results.map(
        (e) => `[${e.type}] ${e.content.slice(0, 200)}${e.tags.length ? ` (${e.tags.join(", ")})` : ""}`,
      );
      return { success: true, data: `Found ${results.length} result(s):\n${lines.join("\n")}` };
    },
  });
}

registerTool("remember", "core");
