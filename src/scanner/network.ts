import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

/**
 * Quick port scan using /dev/tcp (bash built-in, no external tools).
 */
export function createScanPortsTool() {
  return tool({
    description: "Quick TCP port scan using bash's /dev/tcp. Scans common ports on a target host. No external tools needed. Slower but universally available.",
    inputSchema: z.object({
      target: z.string().describe("Target hostname or IP address"),
      ports: z.string().optional().describe("Port range (e.g., '22,80,443' or '1-1024', default: common ports)"),
    }),
    execute: async ({ target, ports }): Promise<ToolResult> => {
      const portList = ports ?? "22,80,443,3306,5432,6379,8080,8443,9000,27017";
      const scanCmd = `
for port in $(echo "${portList}" | tr ',' ' '); do
  timeout 2 bash -c "echo >/dev/tcp/${target}/$port" 2>/dev/null && echo "OPEN: $port" || true
done
`;
      const result = await sh(scanCmd, 120_000);
      if (!result || result.startsWith("Error")) {
        return { success: true, data: `Port scan completed. No open ports found or host unreachable.\n${result}` };
      }
      return { success: true, data: `Port scan results for ${target}:\n${result}` };
    },
  });
}

/**
 * DNS resolution check.
 */
export function createScanDnsTool() {
  return tool({
    description: "Resolve DNS records for a domain (A, AAAA, MX, NS, TXT records). Useful for reconnaissance and verifying DNS configuration.",
    inputSchema: z.object({
      domain: z.string().describe("Domain to look up"),
      type: z.enum(["A", "AAAA", "MX", "NS", "TXT", "ANY"]).optional().describe("DNS record type (default: ANY)"),
    }),
    execute: async ({ domain, type }): Promise<ToolResult> => {
      const recordType = type ?? "ANY";
      const result = await sh(`dig ${domain} ${recordType} +short 2>/dev/null || host -t ${recordType} ${domain} 2>/dev/null || nslookup ${domain} 2>/dev/null`);
      return { success: true, data: `=== DNS ${recordType} records for ${domain} ===\n${result || "(no DNS tools available or domain not found)"}` };
    },
  });
}

registerTool("scan_ports", "core");
registerTool("scan_dns", "core");
