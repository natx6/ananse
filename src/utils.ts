import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import fastGlob from "fast-glob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnanseConfig {
  apiKey?: string;
  provider?: string;
  model?: string;
}

export interface ProjectPersonality {
  path: string;
  content: string;
}

export interface BootCheckResult {
  config: AnanseConfig | null;
  personality: ProjectPersonality | null;
  fileCount: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_PATH = `${homedir()}/.ananse/config.json`;
const PERSONALITY_PATH = resolve(".ananse.md");

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export async function checkConfig(): Promise<AnanseConfig | null> {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as AnanseConfig;
  } catch {
    return null;
  }
}

export async function checkPersonality(): Promise<ProjectPersonality | null> {
  try {
    if (!existsSync(PERSONALITY_PATH)) return null;
    const content = await readFile(PERSONALITY_PATH, "utf-8");
    return { path: PERSONALITY_PATH, content };
  } catch {
    return null;
  }
}

export async function scanDirectory(): Promise<number> {
  try {
    const files = await fastGlob("**/*", {
      ignore: ["node_modules/**", ".git/**", "dist/**"],
      dot: false,
      onlyFiles: true,
    });
    return files.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Orchestrated boot check (for future use)
// ---------------------------------------------------------------------------

export async function bootCheck(): Promise<BootCheckResult> {
  const [config, personality, fileCount] = await Promise.all([
    checkConfig(),
    checkPersonality(),
    scanDirectory(),
  ]);
  return { config, personality, fileCount };
}
