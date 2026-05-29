import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerTool } from "../mode.js";
import type { ToolResult } from "../types.js";

const CONFIG_PATH = join(homedir(), ".ananse", "config.json");

export function createChangeModeTool() {
  return tool({
    description: "Switch Ananse operating mode. Use this when the user asks for capabilities that belong to a different mode. OFFENSE: red-team operations, C2, recon, exploitation, privilege escalation. DEFENSE: blue-team hardening, compliance, monitoring, audit. NORMAL: general-purpose coding assistant.",
    inputSchema: z.object({
      mode: z.enum(["normal", "offense", "defense"]).describe("Target mode to switch to"),
    }),
    execute: async ({ mode }): Promise<ToolResult> => {
      try {
        await mkdir(join(homedir(), ".ananse"), { recursive: true });
        let config: Record<string, unknown> = {};
        try {
          const raw = await readFile(CONFIG_PATH, "utf-8");
          config = JSON.parse(raw);
        } catch {}
        config.mode = mode;
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
        return { success: true, data: `Mode switched to ${mode.toUpperCase()}. The next message will use this mode.` };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

registerTool("change_mode", "core");
