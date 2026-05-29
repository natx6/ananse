import { tool } from "ai";
import { z } from "zod";
import { SshSession, parseTarget } from "./transport.js";
import { setRemoteExec, getRemoteExec } from "./execContext.js";
import { getStealthConfig } from "./stealth.js";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

let activeSession: SshSession | null = null;
let sessionTarget: string | null = null;
let sessionConnectedAt: number | null = null;

/**
 * Get current SSH session info (for the status tool).
 */
export function getSshSessionInfo(): { connected: boolean; target: string | null; uptime: number | null } {
  return {
    connected: activeSession !== null,
    target: sessionTarget,
    uptime: sessionConnectedAt ? Date.now() - sessionConnectedAt : null,
  };
}

export function closeSshSession(): Promise<void> {
  if (activeSession) {
    setRemoteExec(null);
    return activeSession.close().finally(() => {
      activeSession = null;
      sessionTarget = null;
      sessionConnectedAt = null;
    });
  }
  return Promise.resolve();
}

/**
 * Connect to a remote host via SSH and route all subsequent
 * command tool executions through it.
 */
export function createSshConnectTool() {
  return tool({
    description: "Connect to a remote host via SSH. After connecting, all shell commands run on the remote host until you disconnect. Supports user@host and user@host:port formats.",
    inputSchema: z.object({
      target: z.string().describe("SSH target (e.g., 'user@host' or 'user@host:22')"),
      keyPath: z.string().optional().describe("Path to SSH private key (optional)"),
    }),
    execute: async ({ target, keyPath }): Promise<ToolResult> => {
      try {
        // Close any existing session first
        if (activeSession) {
          await closeSshSession();
        }

        const parsed = parseTarget(target);
        if (keyPath) parsed.keyPath = keyPath;

        const session = new SshSession(parsed, getStealthConfig());
        await session.connect();

        activeSession = session;
        sessionTarget = target;
        sessionConnectedAt = Date.now();

        // Route all command tool calls through SSH
        setRemoteExec((cmd: string, timeout?: number) => session.exec(cmd, timeout));

        // Start keepalive pings
        session.keepalive(60_000);

        return {
          success: true,
          data: `Connected to ${target}. All commands will now run remotely.\nUse ssh_disconnect to close the connection.`,
        };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

/**
 * Disconnect from the remote host and restore local execution.
 */
export function createSshDisconnectTool() {
  return tool({
    description: "Disconnect from the current SSH session and restore local command execution.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      if (!activeSession) {
        return { success: true, data: "No active SSH connection." };
      }
      try {
        await closeSshSession();
        return { success: true, data: "SSH session closed. Commands will now run locally." };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

/**
 * Check SSH connection status.
 */
export function createSshStatusTool() {
  return tool({
    description: "Check whether there's an active SSH connection and show its target.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      if (!activeSession || !sessionTarget) {
        return { success: true, data: "No active SSH connection. Commands run locally." };
      }
      const connected = await activeSession.isConnected();
      const uptime = sessionConnectedAt ? Math.round((Date.now() - sessionConnectedAt) / 1000) : 0;
      const mins = Math.floor(uptime / 60);
      const secs = uptime % 60;
      return {
        success: true,
        data: connected
          ? `Connected to ${sessionTarget} (${mins}m ${secs}s uptime). Commands route remotely.`
          : `Connection to ${sessionTarget} lost. Reconnect with ssh_connect.`,
      };
    },
  });
}

registerTool("ssh_connect", "core");
registerTool("ssh_disconnect", "core");
registerTool("ssh_status", "core");
