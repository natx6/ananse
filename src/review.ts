import { streamText } from "ai";
import picocolors from "picocolors";
import { spinner } from "@clack/prompts";
import { execSync } from "node:child_process";
import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";

export async function runReview(config: AnanseConfig): Promise<void> {
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("Error: No valid model from config."));
    return;
  }

  // Get the diff
  let diff: string;
  try {
    diff = execSync("git diff", { encoding: "utf-8" }).trim();
    if (!diff) {
      diff = execSync("git diff --cached", { encoding: "utf-8" }).trim();
    }
    if (!diff) {
      console.log(picocolors.yellow("\n  No changes to review.\n"));
      return;
    }
  } catch {
    console.error(picocolors.red("\n  Not a git repository.\n"));
    return;
  }

  const s = spinner();
  s.start("Reviewing changes...");

  try {
    const result = streamText({
      model,
      system: `You are a thorough code reviewer. Review the following diff for:
- Bugs and logic errors
- Security vulnerabilities
- Type safety issues
- Edge cases not handled
- Code quality and style

Be specific and reference line numbers. Prioritize real issues over style nits.`,
      messages: [
        { role: "user", content: `Review this diff:\n\n\`\`\`diff\n${diff.slice(0, 15000)}\n\`\`\`` },
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
    s.stop("");
    console.error(picocolors.red(`\nReview error: ${error instanceof Error ? error.message : String(error)}`));
  }
}
