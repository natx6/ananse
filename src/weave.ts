import { generateObject } from "ai";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import picocolors from "picocolors";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const typeDefinitionSchema = z.object({
  name: z.string().describe("The name of the type or interface"),
  kind: z.enum(["type", "interface", "class", "enum"]).describe("The kind of declaration"),
  exported: z.boolean().describe("Whether it's exported"),
  properties: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .optional()
    .describe("Key properties/members"),
  description: z.string().optional().describe("Brief description of what this type represents"),
});

const docBlockSchema = z.object({
  name: z.string().describe("The function/class/export name"),
  kind: z.enum(["function", "class", "type", "interface", "export"]).describe("What this is"),
  description: z.string().describe("Description of what it does"),
  params: z
    .array(z.object({ name: z.string(), type: z.string(), description: z.string() }))
    .optional()
    .describe("Parameters"),
  returns: z.string().optional().describe("Return value description"),
});

const typesResultSchema = z.object({
  types: z.array(typeDefinitionSchema),
});

const docsResultSchema = z.object({
  blocks: z.array(docBlockSchema),
});

// ---------------------------------------------------------------------------
// weave types
// ---------------------------------------------------------------------------

export async function weaveTypes(
  filePath: string,
  config: AnanseConfig,
): Promise<void> {
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("Error: No valid model from config."));
    return;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    console.error(picocolors.red(`Error: Cannot read file "${filePath}".`));
    return;
  }

  const result = await generateObject({
    model,
    schema: typesResultSchema,
    system: "You extract type definitions from TypeScript source code. Return structured data only.",
    prompt: `Extract all types, interfaces, classes, and enums from this file:\n\n${content}`,
  });

  console.log(JSON.stringify(result.object, null, 2));
}

// ---------------------------------------------------------------------------
// weave docs
// ---------------------------------------------------------------------------

export async function weaveDocs(
  filePath: string,
  config: AnanseConfig,
): Promise<void> {
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("Error: No valid model from config."));
    return;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    console.error(picocolors.red(`Error: Cannot read file "${filePath}".`));
    return;
  }

  const result = await generateObject({
    model,
    schema: docsResultSchema,
    system: "You document TypeScript source code. Return structured documentation blocks only.",
    prompt: `Document all exports (functions, classes, types) from this file:\n\n${content}`,
  });

  console.log(JSON.stringify(result.object, null, 2));
}
