import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

export function createWebFetchTool() {
  return tool({
    description: "Fetch a URL and return its content as markdown. Use this to read web pages, documentation, CVEs, or any online resource.",
    inputSchema: z.object({
      url: z.string().describe("URL to fetch (e.g., 'https://example.com')"),
      maxChars: z.number().int().min(100).max(50000).optional().describe("Max characters to return (default: 10000)"),
    }),
    execute: async ({ url, maxChars }): Promise<ToolResult> => {
      try {
        const limit = maxChars ?? 10000;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Ananse/1.0" },
        });
        if (!res.ok) {
          return { success: false, data: "", error: `HTTP ${res.status}: ${res.statusText}` };
        }
        const text = await res.text();
        const stripped = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const content = stripped.length > limit ? stripped.slice(0, limit) + "\n… (truncated)" : stripped;
        return { success: true, data: content || "(empty page)" };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

registerTool("web_fetch", "core");
