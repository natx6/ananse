import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { SliverClient } from "./sliver/client.js";
import type { ToolResult } from "../types.js";

let sliver: SliverClient | null = null;

async function getSliver(): Promise<SliverClient> {
  if (!sliver) {
    sliver = new SliverClient(process.env.C2_SLIVER_OPERATOR || "ananse");
    await sliver.connect();
  }
  return sliver;
}

function fmtId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

// ── List fleet ─────────────────────────────────────────────

export function createC2ReachTool() {
  return tool({
    description: "List all registered C2 implants (sessions and beacons) with status and last-seen.",
    inputSchema: z.object({
      includeDetails: z.boolean().optional().describe("Show detailed info per implant"),
    }),
    execute: async ({ includeDetails }): Promise<ToolResult> => {
      try {
        const c = await getSliver();
        const { sessions, beacons } = await c.getFleet();
        const lines: string[] = [];

        lines.push(`Sessions: ${sessions.length}  |  Beacons: ${beacons.length}`);
        lines.push("");

        for (const s of sessions) {
          const color = s.status === "active" ? "active" : "dead";
          lines.push(`  ${fmtId(s.id)}  session  ${s.hostname} (${s.username})  ${s.os}/${s.arch}  [${color}]  via ${s.transport}`);
          if (includeDetails) {
            lines.push(`    Remote: ${s.remoteAddress}  Last: ${s.lastCheckin}`);
          }
        }

        for (const b of beacons) {
          lines.push(`  ${fmtId(b.id)}  beacon   ${b.hostname} (${b.username})  ${b.os}/${b.arch}  [active]  via ${b.transport}  every ${b.interval}s`);
          if (includeDetails) {
            lines.push(`    Last: ${b.lastCheckin}  Next: ${b.nextCheckin}`);
          }
        }

        if (sessions.length === 0 && beacons.length === 0) {
          lines.push("  (no implants registered)");
        }

        return { success: true, data: lines.join("\n") };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

// ── Implant detail ─────────────────────────────────────────

export function createC2ImplantDetailTool() {
  return tool({
    description: "Get detailed information about a specific C2 implant (session or beacon).",
    inputSchema: z.object({
      implantId: z.string().min(1).describe("Implant ID to query"),
    }),
    execute: async ({ implantId }): Promise<ToolResult> => {
      try {
        const c = await getSliver();
        const info = await c.getSessionInfo(implantId);
        return { success: true, data: info };
      } catch (err) {
        return { success: false, data: "", error: `Sliver detail: ${(err as Error).message}` };
      }
    },
  });
}

// ── Execute command on session ─────────────────────────────

export function createC2ExecTool() {
  return tool({
    description: "Execute a shell command on a C2 session implant and get the output.",
    inputSchema: z.object({
      sessionId: z.string().min(1).describe("Session ID to execute on"),
      command: z.string().min(1).describe("Shell command to execute"),
    }),
    execute: async ({ sessionId, command }): Promise<ToolResult> => {
      try {
        const c = await getSliver();
        const output = await c.executeCommand(sessionId, command);
        return { success: true, data: output || "(no output)" };
      } catch (err) {
        return { success: false, data: "", error: `Sliver exec: ${(err as Error).message}` };
      }
    },
  });
}

// ── List tasks for a beacon ────────────────────────────────

export function createC2TaskListTool() {
  return tool({
    description: "List all tasks for a C2 beacon implant with status.",
    inputSchema: z.object({
      beaconId: z.string().min(1).describe("Beacon ID to list tasks for"),
    }),
    execute: async ({ beaconId }): Promise<ToolResult> => {
      try {
        const c = await getSliver();
        const tasks = await c.getTasks(beaconId);
        if (tasks.length === 0) return { success: true, data: "No tasks for this beacon." };
        const lines = tasks.map((t) => {
          const status = t.status;
          const created = t.createdAt ? new Date(t.createdAt).toLocaleString() : "?";
          return `  ${fmtId(t.id)}  ${t.type.padEnd(20)}  ${status.padEnd(12)}  ${created}`;
        });
        return { success: true, data: `Tasks for ${fmtId(beaconId)} (${tasks.length}):\n${lines.join("\n")}` };
      } catch (err) {
        return { success: false, data: "", error: `Sliver tasks: ${(err as Error).message}` };
      }
    },
  });
}

// ── Register tools for offense mode ────────────────────────

registerTool("c2_reach", "offense");
registerTool("c2_implant_detail", "offense");
registerTool("c2_exec", "offense");
registerTool("c2_task_list", "offense");
