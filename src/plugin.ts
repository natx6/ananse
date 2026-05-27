import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "./mode.js";

export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  tools: PluginToolDef[];
}

interface PluginToolDef {
  name: string;
  description: string;
  mode: "core" | "offense" | "defense";
  inputSchema: Record<string, unknown>;
}

export interface PluginToolMap {
  [toolName: string]: ReturnType<typeof tool>;
}

export interface PluginModule {
  createTools: () => PluginToolMap | Promise<PluginToolMap>;
}

const PLUGINS_DIR = join(homedir(), ".ananse", "plugins");

export async function listPlugins(): Promise<PluginManifest[]> {
  if (!existsSync(PLUGINS_DIR)) return [];

  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const manifests: PluginManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PLUGINS_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const content = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content) as PluginManifest;
      manifests.push(manifest);
    } catch {
      // Skip invalid manifests
      continue;
    }
  }

  return manifests;
}

export async function loadPlugin(name: string): Promise<PluginModule | null> {
  const pluginDir = join(PLUGINS_DIR, name);
  const manifestPath = join(pluginDir, "manifest.json");
  const handlerPath = join(pluginDir, "handler.ts");

  if (!existsSync(manifestPath) || !existsSync(handlerPath)) return null;

  try {
    const mod = await import(handlerPath) as PluginModule;
    return mod;
  } catch {
    // Try .js extension
    try {
      const jsHandlerPath = join(pluginDir, "handler.js");
      if (existsSync(jsHandlerPath)) {
        const mod = await import(jsHandlerPath) as PluginModule;
        return mod;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export async function loadAllPlugins(): Promise<PluginToolMap> {
  const manifests = await listPlugins();
  const allTools: PluginToolMap = {};

  for (const manifest of manifests) {
    const mod = await loadPlugin(manifest.name);
    if (!mod) continue;

    try {
      const tools = await mod.createTools();
      for (const [toolName, toolDef] of Object.entries(tools)) {
        // Register with mode system based on manifest
        const def = manifest.tools.find((t) => t.name === toolName);
        if (def) {
          registerTool(toolName, def.mode);
        }
        allTools[toolName] = toolDef;
      }
    } catch {
      // Skip plugins that fail to load
      continue;
    }
  }

  return allTools;
}

export function createPluginSchema(inputSchema: Record<string, unknown>): z.ZodObject<any> {
  const shape: Record<string, z.ZodType> = {};

  for (const [key, def] of Object.entries(inputSchema)) {
    const schemaDef = def as { type?: string; description?: string };
    switch (schemaDef.type) {
      case "string":
        shape[key] = z.string().describe(schemaDef.description ?? "");
        break;
      case "number":
        shape[key] = z.number().describe(schemaDef.description ?? "");
        break;
      case "boolean":
        shape[key] = z.boolean().describe(schemaDef.description ?? "");
        break;
      default:
        shape[key] = z.string().describe(schemaDef.description ?? "");
    }
  }

  return z.object(shape);
}
