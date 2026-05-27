import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import { isStealthEnabled } from "../stealth.js";
import type { ToolResult } from "../types.js";

/**
 * Enumerate running processes.
 */
export function createReconProcessesTool() {
  return tool({
    description: "Enumerate running processes on the target system. Lists PID, name, user, and CPU/memory usage. Use for initial system recon.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const cmd = isStealthEnabled()
        ? "ps -eo pid,comm --no-headers 2>/dev/null"
        : "ps aux --sort=-%mem 2>/dev/null || ps aux 2>/dev/null";
      const output = await sh(cmd);
      const lines = output.split("\n");
      return {
        success: true,
        data: lines.length > 30
          ? `${lines[0]}\n${lines.slice(1, 30).join("\n")}\n... (${lines.length - 30} more processes)`
          : output,
      };
    },
  });
}

/**
 * Enumerate network connections.
 */
export function createReconNetworkTool() {
  return tool({
    description: "Enumerate active network connections, listening ports, and services. Use to map the attack surface.",
    inputSchema: z.object({
      type: z.enum(["all", "listening", "connections"]).optional().describe("Type of network info (default: listening)"),
    }),
    execute: async ({ type }): Promise<ToolResult> => {
      const flag = isStealthEnabled()
        ? (type === "connections" ? "-tuan" : "-tuln")
        : (type === "connections" ? "-tuanp" : "-tulnp");
      const output = await sh(`ss ${flag} 2>/dev/null || netstat ${flag} 2>/dev/null`);
      return { success: true, data: output || "No network info available (requires root)" };
    },
  });
}

/**
 * Enumerate users and groups.
 */
export function createReconUsersTool() {
  return tool({
    description: "List local users, groups, and their privileges. Includes /etc/passwd, /etc/group, sudoers, and currently logged-in users.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const users = await sh("cat /etc/passwd 2>/dev/null");
      parts.push("=== Users ===");
      parts.push(users);

      const groups = await sh("cat /etc/group 2>/dev/null");
      parts.push("\n=== Groups ===");
      parts.push(groups);

      const loggedIn = await sh("who 2>/dev/null");
      if (loggedIn) parts.push(`\n=== Logged In ===\n${loggedIn}`);

      if (!isStealthEnabled()) {
        const sudoers = await sh("cat /etc/sudoers 2>/dev/null | head -30");
        if (sudoers && !sudoers.startsWith("Error")) {
          parts.push(`\n=== Sudoers (first 30 lines) ===\n${sudoers}`);
        }
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Enumerate cron jobs and systemd timers.
 */
export function createReconSchedulerTool() {
  return tool({
    description: "Enumerate scheduled tasks: cron jobs (system and user crontabs), systemd timers, and at jobs. Useful for finding persistence vectors.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const systemCron = await sh("cat /etc/crontab 2>/dev/null");
      parts.push(`=== System Crontab ===\n${systemCron}`);

      const cronDirs = await sh("ls -la /etc/cron.d 2>/dev/null");
      parts.push(`\n=== /etc/cron.d ===\n${cronDirs}`);

      const hourly = await sh("ls -la /etc/cron.hourly 2>/dev/null");
      if (hourly) parts.push(`\n=== /etc/cron.hourly ===\n${hourly}`);

      const systemdTimers = await sh("systemctl list-timers --all 2>/dev/null");
      parts.push(`\n=== Systemd Timers ===\n${systemdTimers || "(systemd not available)"}`);

      const atJobs = await sh("atq 2>/dev/null");
      if (atJobs) parts.push(`\n=== At Jobs ===\n${atJobs}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Enumerate SUID binaries and capabilities.
 */
export function createReconSuidTool() {
  return tool({
    description: "Find SUID/SGID binaries, files with capabilities, and world-writable files owned by root. Common privilege escalation vectors.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      if (isStealthEnabled()) {
        // Targeted SUID check — covers the 5 most common vectors without full FS scan
        const suid = await sh("ls -la /usr/bin/su /usr/bin/sudo /usr/bin/passwd /usr/bin/mount /usr/bin/pkexec 2>/dev/null | grep '^-rws'");
        parts.push(`=== Common SUID Binaries ===\n${suid || "None of the common SUID binaries have the setuid bit set"}`);
      } else {
        const suid = await sh("find / -perm -4000 -type f 2>/dev/null");
        parts.push(`=== SUID Binaries ===\n${suid || "None found"}`);

        const sgid = await sh("find / -perm -2000 -type f 2>/dev/null");
        parts.push(`\n=== SGID Binaries ===\n${sgid || "None found"}`);

        const writable = await sh("find / -writable -type f -user root 2>/dev/null | head -20");
        if (writable) parts.push(`\n=== World-Writable Files Owned by Root (first 20) ===\n${writable}`);
      }

      const capabilities = await sh("getcap /usr/bin/* 2>/dev/null | head -20");
      parts.push(`\n=== Capabilities ===\n${capabilities || "(getcap not available or no capabilities)"}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

// Register all recon tools
registerTool("recon_processes", "offense");
registerTool("recon_network", "offense");
registerTool("recon_users", "offense");
registerTool("recon_scheduler", "offense");
registerTool("recon_suid", "offense");
