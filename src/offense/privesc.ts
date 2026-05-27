import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import { isStealthEnabled } from "../stealth.js";
import type { ToolResult } from "../types.js";

/**
 * Check sudo privileges.
 */
export function createPrivescSudoTool() {
  return tool({
    description: "Check sudo privileges for the current user. Lists allowed commands, NOPASSWD entries, and known sudo exploits.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      if (isStealthEnabled()) {
        // Avoid sudo -l (logged by sudo). Check group membership instead.
        const groupCheck = await sh("groups 2>/dev/null && cat /etc/group 2>/dev/null | grep -E '^(sudo|wheel|admin)'");
        parts.push(`=== Group Membership (stealth) ===\n${groupCheck || "No privileged groups found"}`);
      } else {
        const sudoL = await sh("sudo -l 2>&1");
        parts.push(`=== sudo -l ===\n${sudoL}`);

        const sudoVersion = await sh("sudo --version 2>/dev/null | head -3");
        if (sudoVersion) parts.push(`\n=== Sudo Version ===\n${sudoVersion}`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Check writable scripts and paths.
 */
export function createPrivescWritableTool() {
  return tool({
    description: "Find writable scripts, init files, and paths that could be used for privilege escalation via cron or service hijacking.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      if (isStealthEnabled()) {
        // Just check directory listings — no full FS scans
        const writablePath = await sh("ls -la /usr/local/bin /usr/local/sbin 2>/dev/null | grep '^-rw-rw'");
        if (writablePath) parts.push(`=== Writable Files in Common PATH Dirs ===\n${writablePath}`);

        const systemdWritable = await sh("ls -la /etc/systemd/system/ 2>/dev/null");
        if (systemdWritable) parts.push(`\n=== Systemd Service Files (listing only) ===\n${systemdWritable}`);
      } else {
        // Writable scripts in PATH
        const pathDirs = await sh("echo $PATH");
        const writablePath = await sh("for d in $(echo $PATH | tr ':' ' '); do find $d -writable -type f 2>/dev/null; done");
        if (writablePath) parts.push(`=== Writable Files in PATH ===\n${writablePath}`);

        // Writable systemd service files
        const systemdWritable = await sh("find /etc/systemd -writable -type f 2>/dev/null");
        if (systemdWritable) parts.push(`\n=== Writable Systemd Service Files ===\n${systemdWritable}`);
      }

      // Docker socket
      const dockerSock = await sh("ls -la /var/run/docker.sock 2>/dev/null");
      if (dockerSock) parts.push(`\n=== Docker Socket ===\n${dockerSock}`);

      // LXC/LXD check
      const lxcGroup = await sh("groups 2>/dev/null | grep -o lxd 2>/dev/null || echo ''");
      if (lxcGroup) parts.push("\n=== LXD Group ===\nUser is in the lxd group — potential LXC escape");

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Check kernel and OS for known exploits.
 */
export function createPrivescKernelTool() {
  return tool({
    description: "Check kernel version, OS release, and architecture for known privilege escalation vectors (Dirty Pipe, Dirty COW, etc.).",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const uname = await sh("uname -a");
      parts.push(`=== Kernel ===\n${uname}`);

      const osRelease = await sh("cat /etc/os-release 2>/dev/null | head -10");
      if (osRelease) parts.push(`\n=== OS Release ===\n${osRelease}`);

      const kernelModules = await sh("lsmod 2>/dev/null | head -30");
      parts.push(`\n=== Loaded Kernel Modules (first 30) ===\n${kernelModules || "(lsmod not available)"}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("privesc_sudo", "offense");
registerTool("privesc_writable", "offense");
registerTool("privesc_kernel", "offense");
