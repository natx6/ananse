import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PERSONALITY_PATH = resolve(".ananse.md");

export async function loadPersonality(): Promise<string | null> {
  try {
    if (!existsSync(PERSONALITY_PATH)) return null;
    return await readFile(PERSONALITY_PATH, "utf-8");
  } catch {
    return null;
  }
}

export function buildPersonalityPrompt(content: string | null): string {
  if (!content || !content.trim()) return "";
  return `\n## Project Personality\n\n${content.trim()}\n`;
}
