import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONTEXT_DIR = join(homedir(), ".ananse", "context");

export interface ActionRecord {
  type: string;
  target: string;
  resolved?: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface ContextData {
  sessionId: string;
  accessedPaths: Record<string, number>;
  pathCorrections: Record<string, string>;
  commonDirs: Record<string, number>;
  recentActions: ActionRecord[];
  userFixes: string[];
  knowledge: string[];
  startTime: number;
}

export function createContext(sessionId: string): ContextData {
  return {
    sessionId,
    accessedPaths: {},
    pathCorrections: {},
    commonDirs: {},
    recentActions: [],
    userFixes: [],
    knowledge: [],
    startTime: Date.now(),
  };
}

export async function loadOrCreateContext(sessionId: string): Promise<ContextData> {
  const path = join(CONTEXT_DIR, `${sessionId}.json`);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ContextData;
  } catch {
    return createContext(sessionId);
  }
}

export async function saveContext(ctx: ContextData): Promise<void> {
  if (!existsSync(CONTEXT_DIR)) {
    await mkdir(CONTEXT_DIR, { recursive: true });
  }
  const path = join(CONTEXT_DIR, `${ctx.sessionId}.json`);
  await writeFile(path, JSON.stringify(ctx, null, 2), "utf-8");
}

export function recordAction(
  ctx: ContextData,
  action: ActionRecord,
): void {
  ctx.recentActions.push(action);
  if (ctx.recentActions.length > 20) ctx.recentActions.shift();

  // Track accessed paths
  if (action.target) {
    const key = action.resolved ?? action.target;
    ctx.accessedPaths[key] = (ctx.accessedPaths[key] ?? 0) + 1;

    // Track corrections
    if (action.resolved && action.resolved !== action.target) {
      ctx.pathCorrections[action.target] = action.resolved;
      ctx.userFixes.push(
        `User typed "${action.target}" → resolved to "${action.resolved}"`,
      );
    }

    // Track common dirs
    const dir = getDir(key);
    if (dir) {
      ctx.commonDirs[dir] = (ctx.commonDirs[dir] ?? 0) + 1;
    }
  }
}

export function addKnowledge(ctx: ContextData, fact: string): void {
  const trimmed = fact.trim();
  if (trimmed && !ctx.knowledge.includes(trimmed)) {
    ctx.knowledge.push(trimmed);
    if (ctx.knowledge.length > 30) ctx.knowledge.shift();
  }
}

/**
 * Build a concise natural-language summary of the context for
 * injection into the system prompt.
 */
export function getContextSummary(ctx: ContextData): string {
  const parts: string[] = [];

  // Frequent paths
  const topPaths = Object.entries(ctx.accessedPaths)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topPaths.length > 0) {
    parts.push(
      `Frequent paths: ${topPaths.map(([p]) => p).join(", ")}`,
    );
  }

  // Common directories
  const topDirs = Object.entries(ctx.commonDirs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (topDirs.length > 0) {
    parts.push(
      `Working directories: ${topDirs.map(([d]) => d).join(", ")}`,
    );
  }

  // Known corrections (most recent first, up to 3)
  const fixes = ctx.userFixes.slice(-3);
  if (fixes.length > 0) {
    parts.push(`Path corrections: ${fixes.join("; ")}`);
  }

  // Knowledge about the project
  if (ctx.knowledge.length > 0) {
    const recent = ctx.knowledge.slice(-5);
    parts.push(`Learned: ${recent.join("; ")}`);
  }

  // Last few actions
  const lastActions = ctx.recentActions.slice(-3);
  if (lastActions.length > 0) {
    const lines = lastActions.map(
      (a) => `${a.type} ${a.success ? "✓" : "✗"} ${a.resolved ?? a.target}`,
    );
    parts.push(`Recent: ${lines.join(" | ")}`);
  }

  return parts.length > 0 ? parts.join("\n") : "";
}

function getDir(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return null;
  return path.slice(0, idx);
}
