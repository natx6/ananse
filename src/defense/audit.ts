import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

/**
 * Examine auth logs for security events (failed logins, sudo usage, anomalies).
 */
export function createAuditLogsTool() {
  return tool({
    description: "Examine system authentication and security logs. Detects failed login attempts, sudo usage, service failures, and unusual activity patterns. Supports filtering by time window.",
    inputSchema: z.object({
      lines: z.number().optional().describe("Number of recent log lines to examine (default: 100)"),
      filter: z.enum(["all", "failed", "sudo", "errors"]).optional().describe("Filter log entries by type (default: all)"),
    }),
    execute: async ({ lines, filter }): Promise<ToolResult> => {
      const maxLines = lines ?? 100;
      const parts: string[] = [];

      // Try journald first
      const journalctl = await sh(`journalctl -n ${maxLines} --no-pager 2>/dev/null | grep -iE "fail|error|auth|sudo|invalid" | tail -30`, 10_000);
      if (journalctl && !journalctl.startsWith("Error")) {
        parts.push("=== journalctl (filtered) ===");
        parts.push(journalctl);
      } else {
        // Fallback to log files
        for (const logFile of ["/var/log/auth.log", "/var/log/secure", "/var/log/syslog", "/var/log/messages"]) {
          const logData = await sh(`tail -${maxLines} ${logFile} 2>/dev/null | grep -iE "fail|error|auth|sudo|invalid" | tail -20`, 5_000);
          if (logData && !logData.startsWith("Error") && logData.trim()) {
            parts.push(`=== ${logFile} (filtered) ===`);
            parts.push(logData);
          }
        }
      }

      // Summary statistics
      const failedLogins = await sh(`lastb 2>/dev/null | head -20 || echo "(no failed login data)"`, 5_000);
      if (failedLogins) {
        parts.push("\n=== Failed Login Attempts ===");
        parts.push(failedLogins);
      }

      const sudoEntries = await sh(`grep -c "sudo" /var/log/auth.log 2>/dev/null || journalctl -n 1 2>/dev/null && echo "(checking journal)"`, 5_000);
      if (sudoEntries && !sudoEntries.startsWith("Error")) {
        const count = sudoEntries.trim();
        parts.push(`\n  Sudo events found: ${count}`);
      }

      return {
        success: true,
        data: parts.length > 0 ? parts.join("\n") : "No authentication logs available (requires read access to /var/log or journald).",
      };
    },
  });
}

/**
 * Audit network connections — identify unexpected listening services and unusual outbound connections.
 */
export function createAuditNetworkTool() {
  return tool({
    description: "Audit network connections for security concerns: unexpected listening services (exposed ports), unusual outbound connections (potential C2 or exfil), and non-standard services on common ports.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // All listening services
      const listening = await sh("ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null");
      if (listening) {
        parts.push("=== Listening Services ===");
        parts.push(listening);

        // Flag non-standard listening ports
        const lines = listening.split("\n");
        const unusual: string[] = [];
        const commonPorts = [22, 25, 53, 80, 443, 631, 3306, 5432, 6379, 8080, 8443];
        for (const line of lines) {
          const m = line.match(/:(\d+)\s+/);
          if (m) {
            const port = parseInt(m[1], 10);
            if (!commonPorts.includes(port) && port > 1024) {
              unusual.push(`  ${port} — non-standard service on port ${port}`);
            }
          }
        }
        if (unusual.length > 0) {
          parts.push(`\n  ⚠ Non-standard listening ports:`);
          parts.push(...unusual.slice(0, 10));
        }
      }

      // Active connections
      const connections = await sh("ss -tupn 2>/dev/null | grep ESTAB || netstat -tupn 2>/dev/null | grep ESTABLISHED");
      if (connections) {
        parts.push("\n=== Established Connections ===");
        const connLines = connections.split("\n").filter((l) => l.trim());
        if (connLines.length > 20) {
          parts.push(...connLines.slice(0, 20));
          parts.push(`  ... and ${connLines.length - 20} more connections`);
        } else {
          parts.push(...connLines);
        }
      }

      // Check for promiscuous mode
      const promisc = await sh("ip link show 2>/dev/null | grep -i PROMISC || echo '(no promiscuous interfaces)'");
      if (promisc && !promisc.includes("no promisc")) {
        parts.push(`\n  ⚠ Promiscuous mode detected on some interfaces`);
      }

      return { success: true, data: parts.join("\n") || "Network audit unavailable (requires root or network access)." };
    },
  });
}

/**
 * Audit user accounts — recent logins, sudo activity, privilege changes.
 */
export function createAuditUsersTool() {
  return tool({
    description: "Audit user accounts and authentication activity: recent logins, sudo usage, privilege escalation events, user/group changes, and dormant accounts. Useful for detecting unauthorized access or insider threat indicators.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // Current logged-in users
      const loggedIn = await sh("w -i 2>/dev/null | head -20");
      if (loggedIn) {
        parts.push("=== Currently Logged In ===");
        parts.push(loggedIn);
      }

      // Recent logins
      const lastLogins = await sh("last -20 2>/dev/null || lastlog 2>/dev/null | head -20");
      if (lastLogins) {
        parts.push("\n=== Recent Logins ===");
        parts.push(lastLogins);
      }

      // Users with UID 0 (non-root)
      const uid0 = await sh("awk -F: '($3 == 0) {print}' /etc/passwd 2>/dev/null");
      if (uid0) {
        const users = uid0.split("\n").filter((l) => !l.startsWith("root:"));
        if (users.length > 0) {
          parts.push("\n⚠ Non-root UID 0 accounts:");
          parts.push(...users);
        }
      }

      // Users with shell access
      const shells = await sh("cat /etc/passwd 2>/dev/null | grep -E '/bin/(bash|zsh|sh|fish)' | cut -d: -f1,7");
      if (shells) {
        parts.push("\n=== Users with Shell Access ===");
        parts.push(shells);
      }

      // Sudoers file check
      const sudoers = await sh("cat /etc/sudoers 2>/dev/null | grep -v '^#' | grep -v '^$' | head -20");
      if (sudoers) {
        parts.push("\n=== Sudoers (key entries) ===");
        parts.push(sudoers);
      }

      // Password expiry info
      const passExpiry = await sh("for u in $(cat /etc/passwd | grep -E '/bin/(bash|zsh|sh)' | cut -d: -f1); do echo \"$u: $(chage -l $u 2>/dev/null | grep 'Password expires')\"; done", 10_000);
      if (passExpiry) {
        parts.push("\n=== Password Expiry ===");
        parts.push(passExpiry);
      }

      return { success: true, data: parts.join("\n") || "User audit unavailable (limited permissions)." };
    },
  });
}

registerTool("audit_logs", "defense");
registerTool("audit_network", "defense");
registerTool("audit_users", "defense");
