import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROFILE_PATH = join(homedir(), ".ananse", "profile.json");

export interface UserProfile {
  name: string;
  role: string;
  about: string;
  preferences: string[];
  knownProjects: Array<{ path: string; description: string }>;
  commonPaths: string[];
  traits: string[];
  createdAt: number;
  updatedAt: number;
}

export function defaultProfile(name: string): UserProfile {
  return {
    name,
    role: "",
    about: "",
    preferences: [],
    knownProjects: [],
    commonPaths: [],
    traits: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

let cachedProfile: UserProfile | null = null;

export async function loadProfile(): Promise<UserProfile> {
  if (cachedProfile) return cachedProfile;
  try {
    const raw = await readFile(PROFILE_PATH, "utf-8");
    cachedProfile = JSON.parse(raw) as UserProfile;
    return cachedProfile;
  } catch {
    cachedProfile = defaultProfile("user");
    return cachedProfile;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  profile.updatedAt = Date.now();
  cachedProfile = profile;
  const dir = join(homedir(), ".ananse");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
}

export function getProfileSummary(profile: UserProfile): string {
  const parts: string[] = [];
  parts.push(`Name: ${profile.name}`);
  if (profile.role) parts.push(`Role: ${profile.role}`);
  if (profile.about) parts.push(`About: ${profile.about}`);
  if (profile.preferences.length > 0) {
    parts.push(`Preferences: ${profile.preferences.join(", ")}`);
  }
  if (profile.traits.length > 0) {
    parts.push(`Traits: ${profile.traits.join(", ")}`);
  }
  if (profile.knownProjects.length > 0) {
    for (const p of profile.knownProjects) {
      parts.push(`Project: ${p.path} — ${p.description}`);
    }
  }
  if (profile.commonPaths.length > 0) {
    parts.push(`Common paths: ${profile.commonPaths.join(", ")}`);
  }
  return parts.join("\n");
}

import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";
import type { ToolResult } from "./types.js";

export function createProfileGetTool() {
  return tool({
    description: "Show the current user profile (what Ananse knows about you).",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const profile = await loadProfile();
      return { success: true, data: getProfileSummary(profile) || "(profile empty)" };
    },
  });
}

export function createProfileSetTool() {
  return tool({
    description: "Update your user profile — tell Ananse about yourself, your preferences, projects, and habits. This persists across all sessions.",
    inputSchema: z.object({
      name: z.string().optional().describe("Your name"),
      role: z.string().optional().describe("Your role or title"),
      about: z.string().optional().describe("About you, your goals, what you do"),
      preferences: z.array(z.string()).optional().describe("Your preferences (e.g., 'prefer minimal output', 'use offensive mode by default')"),
      traits: z.array(z.string()).optional().describe("Traits about your working style (e.g., 'works late', 'prefers concise answers')"),
      addProject: z.string().optional().describe("Add a known project path"),
      addProjectDesc: z.string().optional().describe("Description of the project"),
      addPath: z.string().optional().describe("Add a common working path"),
    }),
    execute: async (input): Promise<ToolResult> => {
      const profile = await loadProfile();
      if (input.name) profile.name = input.name;
      if (input.role !== undefined) profile.role = input.role;
      if (input.about !== undefined) profile.about = input.about;
      if (input.preferences) profile.preferences = [...new Set([...profile.preferences, ...input.preferences])];
      if (input.traits) profile.traits = [...new Set([...profile.traits, ...input.traits])];
      if (input.addProject && input.addProjectDesc) {
        const exists = profile.knownProjects.find((p) => p.path === input.addProject);
        if (exists) exists.description = input.addProjectDesc;
        else profile.knownProjects.push({ path: input.addProject, description: input.addProjectDesc });
      }
      if (input.addPath) {
        if (!profile.commonPaths.includes(input.addPath)) profile.commonPaths.push(input.addPath);
      }
      await saveProfile(profile);
      return { success: true, data: `Profile updated.\n${getProfileSummary(profile)}` };
    },
  });
}

registerTool("profile_get", "core");
registerTool("profile_set", "core");
