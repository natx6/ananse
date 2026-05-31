import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

/**
 * Extract readable text from HTML by removing boilerplate and
 * concentrating on content-bearing elements (p, h1-h6, li, a, etc.).
 */
function extractContent(html: string): { title: string; content: string } {
  let title = "";

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Remove unwanted blocks entirely
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<select[^>]*>[\s\S]*?<\/select>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Replace block-level tags with newlines
  cleaned = cleaned
    .replace(/<\/?(?:p|h[1-6]|li|div|tr|td|th|blockquote|pre|br|hr)[^>]*>/gi, "\n")
    .replace(/<\/?(?:ul|ol|table|section|article|main)[^>]*>/gi, "\n\n");

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 10)));

  // Clean up whitespace
  cleaned = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, content: cleaned };
}

export function createWebFetchTool() {
  return tool({
    description: "Fetch a URL and return its readable content. Use this to read web pages, documentation, CVEs, or any online resource.",
    inputSchema: z.object({
      url: z.string().describe("URL to fetch (e.g., 'https://example.com')"),
      maxChars: z.number().int().min(100).max(50000).optional().describe("Max characters to return (default: 10000)"),
    }),
    execute: async ({ url, maxChars }): Promise<ToolResult> => {
      try {
        const limit = maxChars ?? 10000;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Ananse/1.0)" },
        });
        if (!res.ok) {
          return { success: false, data: "", error: `HTTP ${res.status}: ${res.statusText}` };
        }
        const html = await res.text();
        const { title, content } = extractContent(html);

        if (!content) return { success: true, data: "(empty page)" };

        let result = title ? `# ${title}\n\n${content}` : content;
        if (result.length > limit) {
          result = result.slice(0, limit) + "\n\n… (truncated)";
        }
        return { success: true, data: result };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

registerTool("web_fetch", "core");
