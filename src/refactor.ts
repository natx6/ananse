import { ToolLoopAgent, stepCountIs } from "ai";
import picocolors from "picocolors";
import { resolve, relative } from "node:path";
import { text, isCancel } from "@clack/prompts";

import type { AnanseConfig } from "./utils.js";
import { createModelFromConfig } from "./agent.js";
import { loadPersonality } from "./personality.js";
import { crawlDirectory } from "./cobweb.js";
import type { DependencyGraph } from "./cobweb.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createCommandTool,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findAffected(
  graph: DependencyGraph,
  targetPath: string,
): { file: string; resolvedPath: string }[] {
  // Forward deps: what the target imports (only resolved paths)
  const targetEntry = Object.entries(graph).find(([k]) => k === targetPath);
  const forward = targetEntry
    ? targetEntry[1]
        .filter((d) => d.resolvedPath)
        .map((d) => ({ file: d.source, resolvedPath: d.resolvedPath! }))
    : [];

  // Reverse deps: files that import the target
  const reverse: { file: string; resolvedPath: string }[] = [];
  for (const [file, deps] of Object.entries(graph)) {
    if (file === targetPath) continue;
    for (const dep of deps) {
      if (dep.resolvedPath === targetPath) {
        reverse.push({ file, resolvedPath: file });
        break;
      }
    }
  }

  // Transitive: files that import reverse-dependency files
  const reversePaths = new Set(reverse.map((r) => r.resolvedPath));
  const transitive: { file: string; resolvedPath: string }[] = [];
  for (const [file, deps] of Object.entries(graph)) {
    if (file === targetPath || reversePaths.has(file)) continue;
    for (const dep of deps) {
      if (dep.resolvedPath && reversePaths.has(dep.resolvedPath)) {
        transitive.push({ file, resolvedPath: file });
        break;
      }
    }
  }

  return [...forward, ...reverse, ...transitive];
}

function formatBlastRadius(
  targetPath: string,
  graph: DependencyGraph,
): { text: string; allFiles: string[] } {
  const targetEntry = Object.entries(graph).find(([k]) => k === targetPath);
  const forward = targetEntry?.[1] ?? [];
  const cwd = process.cwd();

  // Forward deps
  const forwardLines: string[] = [];
  for (let i = 0; i < forward.length; i++) {
    const dep = forward[i];
    const isLast = i === forward.length - 1;
    const resolved = dep.resolvedPath
      ? ` → ${relative(cwd, dep.resolvedPath)}`
      : "";
    forwardLines.push(`${isLast ? "└──" : "├──"} ${dep.source}${resolved}`);
  }

  // Reverse deps
  const reverse: string[] = [];
  for (const [file, deps] of Object.entries(graph)) {
    if (file === targetPath) continue;
    for (const dep of deps) {
      if (dep.resolvedPath === targetPath) {
        reverse.push(file);
        break;
      }
    }
  }
  const reverseLines = reverse.length
    ? reverse.map((f, i) => `${i === reverse.length - 1 ? "└──" : "├──"} ${relative(cwd, f)}`)
    : ["└── (none)"];

  // Transitive
  const revSet = new Set(reverse);
  const transitive: string[] = [];
  for (const [file, deps] of Object.entries(graph)) {
    if (file === targetPath || revSet.has(file)) continue;
    for (const dep of deps) {
      if (dep.resolvedPath && revSet.has(dep.resolvedPath)) {
        transitive.push(file);
        break;
      }
    }
  }
  const transLines = transitive.length
    ? transitive.map((f, i) => `${i === transitive.length - 1 ? "└──" : "├──"} ${relative(cwd, f)}`)
    : ["└── (none)"];

  const allFiles = [targetPath, ...reverse, ...transitive, ...forward.map((d) => d.resolvedPath).filter((x): x is string => !!x)];

  const text = [
    `${picocolors.cyan(`╭── Blast Radius: ${relative(cwd, targetPath)} ──`)}`,
    ``,
    `  Depends on (${forward.length}):`,
    ...forwardLines.map((l) => `  ${l}`),
    ``,
    `  Depended by (${reverse.length}):`,
    ...reverseLines.map((l) => `  ${l}`),
    ``,
    `  Transitive impact (${transitive.length}):`,
    ...transLines.map((l) => `  ${l}`),
  ].join("\n");

  return { text, allFiles: [...new Set(allFiles)] };
}

// ---------------------------------------------------------------------------
// runRefactor
// ---------------------------------------------------------------------------

export async function runRefactor(
  targetPath: string,
  description: string | undefined,
  config: AnanseConfig,
): Promise<void> {
  const resolvedTarget = resolve(targetPath);

  console.log(picocolors.cyan(`\n  Crawling dependency graph...\n`));
  const graph = await crawlDirectory("src/");

  // Find the matching entry
  const match = Object.keys(graph).find((k) => k === resolvedTarget || k.endsWith(targetPath));
  if (!match) {
    console.error(picocolors.red(`  File not found in dependency graph: ${targetPath}`));
    return;
  }

  // Display blast radius
  const { text: blastText, allFiles } = formatBlastRadius(match, graph);
  console.log(blastText);
  console.log("");

  // Get refactor description
  let refactorDesc = description;
  if (!refactorDesc) {
    const input = await text({
      message: "Describe the refactor you want:",
      placeholder: "e.g., extract the config loading into a separate function",
    });
    if (isCancel(input)) {
      console.log(picocolors.yellow("\n  Cancelled."));
      return;
    }
    refactorDesc = input.trim();
  }

  // Set up model
  const model = createModelFromConfig(config);
  if (!model) {
    console.error(picocolors.red("  Error: No valid model from config."));
    return;
  }

  const personality = await loadPersonality();
  const personalitySection = personality
    ? `\nProject personality:\n${personality}`
    : "";

  const agent = new ToolLoopAgent({
    model,
    instructions: [
      "You are Ananse, an autonomous refactoring agent.",
      "Your task: apply the described refactor carefully and correctly.",
      "",
      "Rules:",
      "- Read the affected files first to understand the current code.",
      "- Make surgical changes — change only what's needed for the refactor.",
      "- After making changes, run 'npm run build' to verify nothing is broken.",
      "- If the build fails, examine the errors and fix them.",
      "- Announce when the refactor is complete.",
      "",
      `Target file: ${match}`,
      `Affected files (read these before making changes):\n${allFiles.join("\n")}`,
      "",
      `User's refactor request: ${refactorDesc}`,
      personalitySection,
    ].filter(Boolean).join("\n"),
    tools: {
      read: createReadTool(),
      write: createWriteTool(),
      edit: createEditTool(),
      command: createCommandTool(),
    },
    stopWhen: stepCountIs(15),
  });

  console.log(picocolors.dim("  Running refactor loop (up to 15 steps)...\n"));

  try {
    const result = await agent.generate({
      prompt: `Apply this refactor: ${refactorDesc}\n\nRead the affected files first, make changes, then run the build to verify.`,
    });

    console.log("");
    console.log(picocolors.dim("─── Refactor Result ───"));
    console.log(result.text ?? "(no output)");
  } catch (error) {
    console.error(
      picocolors.red(`\nRefactor error: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
