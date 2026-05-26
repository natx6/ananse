import { generateObject, tool } from "ai";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import picocolors from "picocolors";
import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import type { ToolResult } from "./types.js";
import { requestPermission } from "./permission.js";

// ---------------------------------------------------------------------------
// Patch schema
// ---------------------------------------------------------------------------

export const patchSchema = z.object({
  filePath: z.string().describe("Path to the file to edit"),
  findText: z.string().describe("Exact text to search for (must be unique in the file)"),
  replaceWith: z.string().describe("Text to replace it with"),
});

export const patchSetSchema = z.object({
  patches: z.array(patchSchema).describe("Ordered list of patches to apply"),
});

export type Patch = z.infer<typeof patchSchema>;

// ---------------------------------------------------------------------------
// applyPatches — validate and apply a set of patches
// ---------------------------------------------------------------------------

export async function applyPatches(patches: Patch[]): Promise<{ success: boolean; results: string[] }> {
  const results: string[] = [];

  for (const p of patches) {
    try {
      const content = await readFile(p.filePath, "utf-8");
      if (!content.includes(p.findText)) {
        results.push(`✗ ${p.filePath}: text not found`);
        continue;
      }
      const updated = content.replace(p.findText, p.replaceWith);
      await writeFile(p.filePath, updated, "utf-8");
      results.push(`✓ ${p.filePath}: patched successfully`);
    } catch (err: unknown) {
      results.push(`✗ ${p.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const success = results.every((r) => r.startsWith("✓"));
  return { success, results };
}

// ---------------------------------------------------------------------------
// generatePatches — use AI to produce structured patches from a description
// ---------------------------------------------------------------------------

export async function generatePatches(
  filePath: string,
  description: string,
  config: AnanseConfig,
): Promise<Patch[]> {
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("  Error: No valid model from config."));
    return [];
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    console.error(picocolors.red(`  Error: Cannot read "${filePath}".`));
    return [];
  }

  const personality = await loadPersonality();
  const context = personality ? `\nProject context:\n${personality}` : "";

  const result = await generateObject({
    model,
    schema: patchSetSchema,
    system: `You generate precise code patches. Each patch must have an exact findText that is unique in the file.${context}`,
    prompt: `File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\`\n\nRequest: ${description}\n\nGenerate the minimal set of patches to implement this change.`,
  });

  return result.object.patches;
}

// ---------------------------------------------------------------------------
// createBatchEditTool — AI-callable tool for applying multiple patches
// ---------------------------------------------------------------------------

export function createBatchEditTool() {
  return tool({
    description: "Apply multiple find-and-replace patches across files in a single call. More efficient than editing one at a time.",
    inputSchema: z.object({
      patches: z.array(patchSchema).describe("Ordered list of patches to apply"),
    }),
    execute: async ({ patches }): Promise<ToolResult> => {
      const permitted = await requestPermission("edit", patches.map((p) => p.filePath).join(", "));
      if (!permitted) {
        return { success: false, data: "", error: "Operation cancelled by user" };
      }
      const { results } = await applyPatches(patches);
      const allOk = results.every((r) => r.startsWith("✓"));
      return {
        success: allOk,
        data: results.join("\n"),
        error: allOk ? undefined : "Some patches failed",
      };
    },
  });
}
