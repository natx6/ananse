import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import { isStealthEnabled } from "../stealth.js";
import type { ToolResult } from "../types.js";

/**
 * CIS benchmark check — SSH configuration.
 */
export function createComplianceSshTool() {
  return tool({
    description: "Check SSH daemon configuration against CIS benchmarks. Verifies: Protocol, PermitRootLogin, PasswordAuthentication, X11Forwarding, MaxAuthTries, ClientAliveInterval, and more.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const checks: string[] = [];
      const config = await sh("cat /etc/ssh/sshd_config 2>/dev/null");

      if (!config || config.startsWith("Error")) {
        return { success: true, data: "SSHD config not found or not accessible." };
      }

      const checkItems: Array<{ key: string; passValue: string; description: string }> = [
        { key: "Protocol", passValue: "2", description: "Only protocol 2" },
        { key: "PermitRootLogin", passValue: "no", description: "Root login disabled" },
        { key: "PasswordAuthentication", passValue: "no", description: "Password auth disabled" },
        { key: "X11Forwarding", passValue: "no", description: "X11 forwarding disabled" },
        { key: "MaxAuthTries", passValue: "4", description: "Max auth tries ≤ 4" },
        { key: "ClientAliveInterval", passValue: "300", description: "Client alive interval" },
        { key: "ClientAliveCountMax", passValue: "0", description: "Max client alive count" },
        { key: "PermitEmptyPasswords", passValue: "no", description: "Empty passwords disabled" },
        { key: "UsePAM", passValue: "yes", description: "PAM enabled" },
      ];

      for (const item of checkItems) {
        const regex = new RegExp(`^${item.key}\\s+(${item.passValue})`, "m");
        const match = regex.exec(config);
        checks.push(match ? `PASS: ${item.key} → ${item.description}` : `FAIL: ${item.key} — ${item.description}`);
      }

      return { success: true, data: `=== SSH CIS Checks ===\n${checks.join("\n")}` };
    },
  });
}

/**
 * CIS benchmark check — password policy.
 */
export function createCompliancePasswordTool() {
  return tool({
    description: "Check password policy configuration: /etc/login.defs, pam.d/common-password, and umask settings. Maps to CIS benchmark controls.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // Password aging
      const loginDefs = await sh("cat /etc/login.defs 2>/dev/null | grep -E 'PASS_MAX_DAYS|PASS_MIN_DAYS|PASS_MIN_LEN|PASS_WARN_AGE' | head -10");
      parts.push(`=== Password Aging (/etc/login.defs) ===\n${loginDefs || "(not found)"}`);

      // Umask
      const umask = await sh("umask");
      parts.push(`\n=== Umask ===\nCurrent umask: ${umask}`);

      // PAM password quality
      const pamPassword = await sh("cat /etc/pam.d/common-password 2>/dev/null | grep -v '^#' | grep -v '^$'");
      if (pamPassword) parts.push(`\n=== PAM Password Config ===\n${pamPassword}`);

      // Check if shadow file exists (stealth: avoid stat that triggers auditd)
      if (isStealthEnabled()) {
        const shadowExists = await sh("test -f /etc/shadow && echo 'exists' || echo 'not found'");
        parts.push(`\n=== Shadow File ===\nFile ${shadowExists}`);
      } else {
        const shadowCheck = await sh("ls -la /etc/shadow 2>/dev/null");
        parts.push(`\n=== Shadow File Permissions ===\n${shadowCheck}`);
      }

      const results = [];
      results.push(loginDefs ? "CHECK: Password aging configured" : "FAIL: No password aging config found");
      results.push(umask === "0022" || umask === "0027" ? "PASS: Umask is restrictive" : `WARN: Umask is ${umask} (recommended: 0022 or 0027)`);

      parts.push(`\n=== Results ===\n${results.join("\n")}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * CIS benchmark check — filesystem mount options.
 */
export function createComplianceMountTool() {
  return tool({
    description: "Check mounted filesystems for security options: noexec, nosuid, nodev on /tmp, /var/tmp, /dev/shm. Maps to CIS benchmark filesystem controls.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const mounts = await sh("mount | grep -E '/tmp|/var/tmp|/dev/shm'");
      if (!mounts) return { success: true, data: "No /tmp, /var/tmp, or /dev/shm mounts found." };

      const checks: string[] = [];
      const lines = mounts.split("\n");
      for (const line of lines) {
        const hasNoexec = line.includes("noexec");
        const hasNosuid = line.includes("nosuid");
        const hasNodev = line.includes("nodev");
        const mountPoint = line.split(" ")[2] ?? line;
        const fails: string[] = [];
        if (!hasNoexec) fails.push("noexec");
        if (!hasNosuid) fails.push("nosuid");
        if (!hasNodev) fails.push("nodev");
        if (fails.length === 0) {
          checks.push(`PASS: ${mountPoint} — all security options set`);
        } else {
          checks.push(`FAIL: ${mountPoint} — missing: ${fails.join(", ")}`);
        }
      }

      return { success: true, data: `=== Filesystem Mount Checks ===\n${mounts}\n\n${checks.join("\n")}` };
    },
  });
}

/**
 * Check auditd configuration.
 */
export function createComplianceAuditdTool() {
  return tool({
    description: "Check audit daemon (auditd) configuration and rules. Maps to CIS benchmark logging controls.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      if (isStealthEnabled()) {
        // Avoid invoking auditctl (triggers audit subsystem). Check existence only.
        const auditDir = await sh("test -d /etc/audit && echo 'present' || echo 'not found'");
        parts.push(`=== Audit Daemon ===\nauditd config directory: ${auditDir}`);
      } else {
        const auditStatus = await sh("auditctl -s 2>/dev/null || echo '(auditd not available)'");
        parts.push(`=== Audit Status ===\n${auditStatus}`);

        const auditRules = await sh("auditctl -l 2>/dev/null | head -30 || echo '(no rules or not available)'");
        parts.push(`\n=== Audit Rules (first 30) ===\n${auditRules}`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("compliance_ssh", "defense");
registerTool("compliance_password", "defense");
registerTool("compliance_mount", "defense");
registerTool("compliance_auditd", "defense");
