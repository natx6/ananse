import { tool } from "ai";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import fastGlob from "fast-glob";
import { registerTool } from "../mode.js";
import type { ToolResult } from "../types.js";

const SECRET_PATTERNS = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey|secret)[=:]["']?[A-Za-z0-9_\-]{16,}/gi },
  { name: "Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g },
  { name: "npm Token", pattern: /npm_[A-Za-z0-9]{36,}/g },
  { name: "Slack Token", pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/g },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
];

const OWASP_PATTERNS = [
  { name: "SQL Injection", pattern: /(?:\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b)(?:[^;]*\+|.*\$\{)/gi },
  { name: "Command Injection", pattern: /(?:exec|execSync|execFile|spawn)\([^)]*\+/g },
  { name: "Path Traversal", pattern: /(?:readFile|readFileSync|writeFile|writeFileSync)\([^)]*\.\.(?:\/|\\)/g },
  { name: "eval() Usage", pattern: /\beval\s*\(/g },
  { name: "innerHTML Assignment", pattern: /\.innerHTML\s*=/g },
  { name: "Insecure Crypto", pattern: /(?:MD5|SHA1|sha1|md5)\s*\(/g },
];

/**
 * Scan for hardcoded secrets in project files.
 */
export function createScanSecretsTool() {
  return tool({
    description: "Scan project files for hardcoded secrets, API keys, tokens, and private keys. Checks common secret patterns across all non-binary files.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory to scan (default: current directory)"),
    }),
    execute: async ({ path }): Promise<ToolResult> => {
      const scanPath = path ?? ".";
      const files = await fastGlob(`${scanPath}/**/*`, {
        ignore: ["node_modules/**", ".git/**", "dist/**", "*.min.js", "*.map"],
        dot: false,
        onlyFiles: true,
      });

      const findings: Array<{ file: string; secret: string }> = [];

      for (const file of files.slice(0, 500)) {
        try {
          const content = await readFile(file, "utf-8");
          for (const secret of SECRET_PATTERNS) {
            const matches = content.match(secret.pattern);
            if (matches) {
              findings.push({ file, secret: `${secret.name} (${matches.length} match(es))` });
            }
          }
        } catch {
          // Skip binary files
        }
      }

      if (findings.length === 0) {
        return { success: true, data: "No hardcoded secrets detected in project files." };
      }

      const grouped = findings.map((f) => `  ${f.file}: ${f.secret}`).join("\n");
      return {
        success: true,
        data: `⚠ Found ${findings.length} potential secret(s):\n${grouped}\n\nReview each finding — some may be false positives.`,
      };
    },
  });
}

/**
 * Scan for OWASP Top 10 vulnerability patterns in code.
 */
export function createScanOwaspTool() {
  return tool({
    description: "Scan code for common OWASP Top 10 vulnerability patterns: SQL injection, command injection, path traversal, XSS, insecure crypto, and more.",
    inputSchema: z.object({
      path: z.string().optional().describe("File or directory to scan (default: current directory)"),
    }),
    execute: async ({ path }): Promise<ToolResult> => {
      const scanPath = path ?? ".";
      const files = await fastGlob(`${scanPath}/**/*.{ts,js,jsx,tsx,py,java,go,rs,php}`, {
        ignore: ["node_modules/**", ".git/**", "dist/**"],
        dot: false,
        onlyFiles: true,
      });

      const findings: Array<{ file: string; vuln: string }> = [];

      for (const file of files.slice(0, 300)) {
        try {
          const content = await readFile(file, "utf-8");
          for (const vuln of OWASP_PATTERNS) {
            const matches = content.match(vuln.pattern);
            if (matches) {
              findings.push({ file, vuln: `${vuln.name} (${matches.length} match(es))` });
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      if (findings.length === 0) {
        return { success: true, data: "No OWASP Top 10 patterns detected in scanned files." };
      }

      const grouped = findings.map((f) => `  ${f.file}: ${f.vuln}`).join("\n");
      return {
        success: true,
        data: `⚠ Found ${findings.length} potential vulnerability pattern(s):\n${grouped}\n\nManual review required — static analysis may produce false positives.`,
      };
    },
  });
}

registerTool("scan_secrets", "core");
registerTool("scan_owasp", "core");
