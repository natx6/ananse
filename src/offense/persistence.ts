import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

/**
 * Audit SSH authorized_keys for all users.
 */
export function createPersistSshKeysTool() {
  return tool({
    description: "Find and list SSH authorized_keys files for all users. Helps identify backdoor access and weak key management.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const keys = await sh("find /home /root -name authorized_keys -type f 2>/dev/null");
      if (!keys) return { success: true, data: "No authorized_keys files found." };

      const parts: string[] = ["=== SSH Authorized Keys ==="];
      const files = keys.split("\n");
      for (const file of files) {
        const content = await sh(`cat "${file}" 2>/dev/null | head -5`);
        if (content) parts.push(`\n${file}:\n${content}`);
      }

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Check for persistence mechanisms in startup files.
 */
export function createPersistStartupTool() {
  return tool({
    description: "Check common persistence points: .bashrc, .profile, XDG autostart, LD_PRELOAD, and shell init files.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // Shell init files
      const bashrc = await sh("cat ~/.bashrc 2>/dev/null | head -30");
      if (bashrc) parts.push(`=== ~/.bashrc (first 30 lines) ===\n${bashrc}`);

      const profile = await sh("cat ~/.profile 2>/dev/null | head -20");
      if (profile) parts.push(`\n=== ~/.profile (first 20 lines) ===\n${profile}`);

      // LD_PRELOAD
      const ldPreload = await sh("echo ${LD_PRELOAD:-'(not set)'}");
      parts.push(`\n=== LD_PRELOAD ===\n${ldPreload}`);

      // LD_LIBRARY_PATH
      const ldLibPath = await sh("echo ${LD_LIBRARY_PATH:-'(not set)'}");
      parts.push(`\n=== LD_LIBRARY_PATH ===\n${ldLibPath}`);

      // XDG autostart
      const autostart = await sh("ls -la ~/.config/autostart 2>/dev/null || echo '(no autostart)'");
      parts.push(`\n=== XDG Autostart ===\n${autostart}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Check SSH config for persistence vectors.
 */
export function createPersistSshConfigTool() {
  return tool({
    description: "Examine SSH client config (~/.ssh/config) for unusual configurations: ProxyJump, ProxyCommand, port forwards, or suspicious hosts.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      const sshConfig = await sh("cat ~/.ssh/config 2>/dev/null");
      parts.push(`=== ~/.ssh/config ===\n${sshConfig || "(not found)"}`);

      const knownHosts = await sh("cat ~/.ssh/known_hosts 2>/dev/null | head -20");
      if (knownHosts) parts.push(`\n=== ~/.ssh/known_hosts (first 20 lines) ===\n${knownHosts}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

registerTool("persist_ssh_keys", "offense");
registerTool("persist_startup", "offense");
registerTool("persist_ssh_config", "offense");
