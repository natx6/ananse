import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import type { ToolResult } from "../types.js";
import { readConfigKey } from "../config.js";

const SHODAN_API = "https://api.shodan.io";

async function shodanGet(path: string): Promise<Record<string, unknown> | string> {
  const key = readConfigKey("shodan_key");
  if (!key) {
    throw new Error("Shodan API key not set. Run: ananse config set shodan_key <key>");
  }
  const res = await fetch(`${SHODAN_API}${path}${path.includes("?") ? "&" : "?"}key=${key}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shodan API error (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Look up a specific IP address on Shodan.
 */
export function createShodanIPTool() {
  return tool({
    description: "Look up an IP address on Shodan. Returns open ports, services, banners, geolocation, and any known vulnerabilities. Useful for external recon without touching the target.",
    inputSchema: z.object({
      ip: z.string().describe("IP address to look up"),
      minify: z.boolean().optional().describe("Return concise results (default: true)"),
    }),
    execute: async ({ ip, minify }): Promise<ToolResult> => {
      const data = await shodanGet(`/shodan/host/${ip}`);
      if (typeof data === "string") return { success: true, data };

      const parts: string[] = [];
      parts.push(`  IP:        ${data.ip_str ?? ip}`);
      parts.push(`  Hostname:  ${String(data.hostnames ?? "—")}`);
      parts.push(`  OS:        ${String(data.os ?? "unknown")}`);
      parts.push(`  City:      ${String(data.city ?? "—")}, ${String(data.country_name ?? "—")}`);
      parts.push(`  Org:       ${String(data.org ?? "—")}`);
      parts.push(`  Updated:   ${String(data.last_update ?? "—")}`);

      const ports = data.ports as string[] ?? [];
      if (ports.length > 0) {
        parts.push(`\n  Open ports (${ports.length}): ${ports.join(", ")}`);
      }

      const vulns = data.vulns as string[] ?? [];
      if (vulns && vulns.length > 0) {
        parts.push(`\n  Vulnerabilities (${vulns.length}):`);
        for (const v of vulns.slice(0, 15)) {
          parts.push(`    ⚠ ${v}`);
        }
        if (vulns.length > 15) parts.push(`    ... and ${vulns.length - 15} more`);
      }

      // Show service banners for each open port
      const services = data.data as Array<Record<string, unknown>> ?? [];
      if (services.length > 0 && !minify) {
        parts.push("\n  Service details:");
        for (const s of services.slice(0, 10)) {
          const p = s.port;
          const transport = s.transport as string ?? "tcp";
          const product = s.product as string ?? "";
          const version = s.version as string ?? "";
          parts.push(`    ${p}/${transport}  ${product} ${version}`.trim());
        }
      } else if (services.length > 0) {
        parts.push(`\n  (use minify=false for full service banners)`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Search Shodan for devices matching a query.
 */
export function createShodanSearchTool() {
  return tool({
    description: "Search Shodan for internet-connected devices matching a query. Supports filters like 'port:22', 'country:US', 'product:nginx', 'os:Windows'. Returns top results with IP, ports, and hostnames. Use for broad reconnaissance.",
    inputSchema: z.object({
      query: z.string().describe("Shodan search query (e.g., 'product:nginx country:JP', 'port:3306', 'cisco')"),
      limit: z.number().optional().describe("Results to return (default: 10, max: 50)"),
    }),
    execute: async ({ query, limit }): Promise<ToolResult> => {
      const maxResults = Math.min(limit ?? 10, 50);
      const data = await shodanGet(`/shodan/host/search?query=${encodeURIComponent(query)}&limit=${maxResults}`);
      if (typeof data === "string") return { success: true, data };

      const total = data.total as number ?? 0;
      const matches = data.matches as Array<Record<string, unknown>> ?? [];

      const parts: string[] = [];
      parts.push(`  Query: "${query}" — ${total.toLocaleString()} results\n`);

      for (const m of matches.slice(0, maxResults)) {
        const ip = m.ip_str as string ?? "?";
        const port = m.port as number ?? "?";
        const hostname = (m.hostnames as string[] ?? []).join(", ") || "—";
        const product = m.product as string ?? "";
        const os = m.os as string ?? "";
        parts.push(`  ${ip}:${port}  ${hostname}`.trim());
        if (product || os) parts.push(`    ${product} ${os}`.trim());
      }

      if (total > maxResults) {
        parts.push(`  ... and ${total - maxResults} more results`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("shodan_ip", "offense");
registerTool("shodan_search", "offense");
