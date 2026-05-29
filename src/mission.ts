import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

const MISSIONS_DIR = join(homedir(), ".ananse", "missions");

export interface MissionStep {
  label: string;
  description: string;
  done: boolean;
}

export interface Mission {
  id: string;
  goal: string;
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  active: boolean;
}

// Current mission state for this session
let currentMission: Mission | null = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function ensureDir(): Promise<void> {
  if (!existsSync(MISSIONS_DIR)) {
    await mkdir(MISSIONS_DIR, { recursive: true });
  }
}

async function saveMission(m: Mission): Promise<void> {
  await ensureDir();
  const path = join(MISSIONS_DIR, `${m.id}.json`);
  await writeFile(path, JSON.stringify(m, null, 2), "utf-8");
}

async function loadMission(id: string): Promise<Mission | null> {
  try {
    const path = join(MISSIONS_DIR, `${id}.json`);
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Mission;
  } catch {
    return null;
  }
}

export async function loadLatestMission(): Promise<Mission | null> {
  try {
    await ensureDir();
    const files = await readdir(MISSIONS_DIR);
    const missionFiles = files.filter((f) => f.endsWith(".json"));
    if (missionFiles.length === 0) return null;
    // Sort by when they were last modified (in filename order — latest first)
    missionFiles.sort().reverse();
    const latest = await loadMission(missionFiles[0].replace(/\.json$/, ""));
    if (latest?.active) {
      currentMission = latest;
      return latest;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Summary for system prompt injection
// ---------------------------------------------------------------------------

export function getMissionSummary(): string | null {
  if (!currentMission || !currentMission.active) return null;

  const total = currentMission.steps.length;
  const done = currentMission.steps.filter((s) => s.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const lines: string[] = [
    `CURRENT MISSION: ${currentMission.goal}`,
    `Progress: ${done}/${total} steps (${pct}%)`,
  ];

  for (const step of currentMission.steps) {
    lines.push(`  ${step.done ? "[✓]" : "[ ]"} ${step.label} — ${step.description}`);
  }

  return lines.join("\n");
}

export function clearMissionCache(): void {
  currentMission = null;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Set a persistent mission goal. The AI tracks progress across turns.
 */
export function createMissionSetTool() {
  return tool({
    description: "Set a persistent mission goal. The mission is saved and tracked across turns. Use this when the user gives you a long-term objective.",
    inputSchema: z.object({
      goal: z.string().describe("The mission objective"),
      steps: z.array(z.object({
        label: z.string().describe("Step name (e.g., 'Recon network')"),
        description: z.string().describe("What this step involves"),
      })).describe("Ordered steps to accomplish the mission"),
    }),
    execute: async ({ goal, steps }): Promise<ToolResult> => {
      const mission: Mission = {
        id: `mission_${Date.now()}`,
        goal,
        steps: steps.map((s) => ({ ...s, done: false })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
      };

      currentMission = mission;
      await saveMission(mission);

      const stepList = mission.steps.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
      return {
        success: true,
        data: `Mission set: "${goal}"\nSteps:\n${stepList}\n\nUse mission_status to check progress, mission_step to mark steps complete.`,
      };
    },
  });
}

/**
 * Mark a step as complete and move to the next.
 */
export function createMissionStepTool() {
  return tool({
    description: "Mark a mission step as complete. Updates progress.",
    inputSchema: z.object({
      stepNumber: z.number().int().min(1).describe("Step number to mark complete (1-based)"),
    }),
    execute: async ({ stepNumber }): Promise<ToolResult> => {
      if (!currentMission || !currentMission.active) {
        return { success: false, data: "", error: "No active mission. Set one with mission_set first." };
      }

      const idx = stepNumber - 1;
      if (idx < 0 || idx >= currentMission.steps.length) {
        return {
          success: false,
          data: "",
          error: `Step ${stepNumber} out of range. Mission has ${currentMission.steps.length} steps.`,
        };
      }

      currentMission.steps[idx].done = true;
      currentMission.updatedAt = Date.now();
      await saveMission(currentMission);

      const done = currentMission.steps.filter((s) => s.done).length;
      const total = currentMission.steps.length;
      const next = currentMission.steps.findIndex((s) => !s.done);

      let msg = `Step ${stepNumber} complete (${done}/${total}).`;
      if (next !== -1) {
        msg += ` Next: ${currentMission.steps[next].label}`;
      } else {
        msg += ` All steps complete! Use mission_cancel to close this mission or mission_set to start a new one.`;
      }

      return { success: true, data: msg };
    },
  });
}

/**
 * Check mission progress.
 */
export function createMissionStatusTool() {
  return tool({
    description: "Show current mission progress and remaining steps.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      if (!currentMission || !currentMission.active) {
        return { success: true, data: "No active mission. Set one with mission_set." };
      }

      const summary = getMissionSummary();
      return { success: true, data: summary ?? "No active mission." };
    },
  });
}

/**
 * Cancel the current mission.
 */
export function createMissionCancelTool() {
  return tool({
    description: "Cancel the current mission and mark it inactive.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      if (!currentMission) {
        return { success: true, data: "No active mission to cancel." };
      }

      currentMission.active = false;
      currentMission.updatedAt = Date.now();
      await saveMission(currentMission);
      const goal = currentMission.goal;
      currentMission = null;

      return { success: true, data: `Mission cancelled: "${goal}".` };
    },
  });
}

registerTool("mission_set", "core");
registerTool("mission_step", "core");
registerTool("mission_status", "core");
registerTool("mission_cancel", "core");
