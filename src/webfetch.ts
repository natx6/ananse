import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

/**
 * Extract readable text from HTML.
 */
function extractContent(html: string): { title: string; content: string } {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<select[^>]*>[\s\S]*?<\/select>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:p|h[1-6]|li|div|tr|td|th|blockquote|pre|br|hr)[^>]*>/gi, "\n")
    .replace(/<\/?(?:ul|ol|table|section|article|main)[^>]*>/gi, "\n\n");

  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 10)));

  cleaned = cleaned.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();

  return { title, content: cleaned };
}

/**
 * web_fetch — Fetch a specific URL and return readable content.
 */
export function createWebFetchTool() {
  return tool({
    description: "Fetch a URL and return its readable content. Use for docs, APIs, or known URLs.",
    inputSchema: z.object({
      url: z.string().describe("URL to fetch (e.g., 'https://example.com')"),
      maxChars: z.number().int().min(100).max(50000).optional().describe("Max chars (default: 10000)"),
    }),
    execute: async ({ url, maxChars }): Promise<ToolResult> => {
      try {
        const limit = maxChars ?? 10000;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Ananse/1.0)" },
        });
        if (!res.ok) return { success: false, data: "", error: `HTTP ${res.status}: ${res.statusText}` };
        const html = await res.text();
        const { title, content } = extractContent(html);
        if (!content) return { success: true, data: "(empty page)" };
        let result = title ? `# ${title}\n\n${content}` : content;
        if (result.length > limit) result = result.slice(0, limit) + "\n\n… (truncated)";
        return { success: true, data: result };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

/**
 * web_search — Search the web via DuckDuckGo and return results with descriptions.
 */
export function createWebSearchTool() {
  return tool({
    description: "Search the web for information. Returns results with titles, snippets, and URLs.",
    inputSchema: z.object({
      query: z.string().describe("Search query (e.g., 'latest news about AI')"),
      maxResults: z.number().int().min(1).max(20).optional().describe("Max results (default: 5)"),
    }),
    execute: async ({ query, maxResults }): Promise<ToolResult> => {
      try {
        const limit = maxResults ?? 5;
        const encoded = encodeURIComponent(query);
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          signal: AbortSignal.timeout(15000),
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Ananse/1.0)",
            "Accept": "text/html",
          },
        });
        if (!res.ok) return { success: false, data: "", error: `HTTP ${res.status}` };

        const html = await res.text();

        // Parse search result blocks from DuckDuckGo HTML
        const results: Array<{ title: string; snippet: string; url: string }> = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
          const url = match[1];
          const title = match[2].replace(/<[^>]+>/g, "").trim();
          const snippet = match[3].replace(/<[^>]+>/g, "").replace(/&#?\w+;/g, "").trim();
          if (title) results.push({ title, snippet, url });
        }

        // Fallback: extract from <h2> and <a> result links
        if (results.length === 0) {
          const linkRegex = /<a[^>]*class="result__a"[^>]*(?:href="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi;
          while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
            const url = match[1] || "";
            const title = match[2].replace(/<[^>]+>/g, "").trim();
            if (title && !title.includes(" ")) continue;
            if (title) results.push({ title, snippet: "", url });
          }
        }

        if (results.length === 0) {
          // Last fallback: just extract page content
          const { title, content } = extractContent(html);
          return { success: true, data: `Search results for "${query}"\n\n${content.slice(0, 3000)}` };
        }

        const lines = [`Search results for "${query}":`, ""];
        for (const r of results) {
          lines.push(`  ${r.title}`);
          if (r.snippet) lines.push(`  ${r.snippet}`);
          if (r.url) lines.push(`  ${r.url}`);
          lines.push("");
        }

        return { success: true, data: lines.join("\n").trim() };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

registerTool("web_fetch", "core");
registerTool("web_search", "core");
