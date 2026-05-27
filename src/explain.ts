import { streamText } from "ai";
import picocolors from "picocolors";
import { spinner } from "@clack/prompts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";

export async function runExplain(
  filePath: string,
  config: AnanseConfig,
  target?: string,
): Promise<void> {
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("Error: No valid model from config."));
    return;
  }

  let content: string;
  try {
    content = await readFile(resolve(filePath), "utf-8");
  } catch {
    console.error(picocolors.red(`\n  Cannot read: "${filePath}"\n`));
    return;
  }

  const prompt = target
    ? `Explain the "${target}" function/class in this file:\n\n\`\`\`\n${content}\n\`\`\``
    : `Explain what this file does and how it works:\n\n\`\`\`\n${content}\n\`\`\``;

  console.log(picocolors.dim(`\n  Explaining ${filePath}${target ? ` (${target})` : ""}...\n`));

  const s = spinner();
  s.start(`Analyzing ${filePath}${target ? ` (${target})` : ""}...`);

  try {
    const result = streamText({
      model,
      system: `You explain code clearly and concisely. Focus on:
- What the code does (purpose)
- How it works (key patterns and algorithms)
- Why certain design choices were made
- The public API and important internals

Be detailed but avoid restating the code verbatim.`,
      messages: [{ role: "user", content: prompt }],
    });

    let streamed = false;
    for await (const chunk of result.textStream) {
      if (!streamed) {
        streamed = true;
        s.stop("");
      }
      process.stdout.write(chunk);
    }
    if (!streamed) s.stop("");
    console.log("");

    const usage = await result.usage;
    if (usage) {
      const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      console.log(picocolors.dim(`  Tokens: ${total} (${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out)\n`));
    }
  } catch (error) {
    console.error(picocolors.red(`\nExplain error: ${error instanceof Error ? error.message : String(error)}`));
  }
}
