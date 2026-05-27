import { streamText } from "ai";
import picocolors from "picocolors";
import { spinner } from "@clack/prompts";
import { readFile } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";

export async function runTestGen(filePath: string, config: AnanseConfig): Promise<void> {
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

  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const testPath = `${base}.test${ext}`;

  const s = spinner();
  s.start("Generating tests...");

  try {
    const result = streamText({
      model,
      system: `You generate production-quality unit tests. Follow these rules:
- Use the project's existing test framework (default to vitest)
- Cover: happy path, edge cases, error states
- Mock external dependencies where appropriate
- Test both the public API and significant internal logic
- Output ONLY the test code, no explanations`,
      messages: [
        { role: "user", content: `Generate a test file for:\n\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\`\n\nThe test file should be named "${testPath}".` },
      ],
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
    console.error(picocolors.red(`\nTest generation error: ${error instanceof Error ? error.message : String(error)}`));
  }
}
