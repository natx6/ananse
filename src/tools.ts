import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fastGlob from "fast-glob";
import { requestPermission } from "./permission.js";
import { resolveUserPath } from "./pathResolver.js";
import { crawlDependencies, crawlDirectory, computeReverseDeps } from "./cobweb.js";
import { detectAndCondense } from "./diagnose.js";
import type { ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

const MAX_TIMEOUT_MS = 300_000;

export function createReadTool() {
  return tool({
    description:
      "Read the contents of a file. Supports optional offset and limit for line ranges.",
    inputSchema: z.object({
      path: z.string().describe("The absolute path to the file to read"),
      offset: z.number().int().min(0).optional().describe("Starting line (0-indexed)"),
      limit: z.number().int().min(1).optional().describe("Number of lines to read"),
    }),
    execute: async ({ path, offset, limit }): Promise<ToolResult> => {
      const permitted = await requestPermission("read", path);
      if (!permitted) {
        return { success: false, data: "", error: "Operation cancelled by user" };
      }
      try {
        const content = await readFile(path, "utf-8");
        if (offset !== undefined || limit !== undefined) {
          const lines = content.split("\n");
          const start = offset ?? 0;
          const end = limit !== undefined ? start + limit : undefined;
          return { success: true, data: lines.slice(start, end).join("\n") };
        }
        return { success: true, data: content };
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") {
          // Try to resolve the path before giving up
          const resolved = await resolveUserPath(path);
          if (resolved && resolved.path !== path) {
            try {
              const content = await readFile(resolved.path, "utf-8");
              return {
                success: true,
                data: `[Note: path "${path}" resolved to "${resolved.path}"${resolved.note ? ` — ${resolved.note}` : ""}]\n\n${content}`,
              };
            } catch { /* fall through to original error */ }
          }
          return { success: false, data: "", error: `File not found: ${path}` };
        }
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createWriteTool() {
  return tool({
    description: "Write content to a file, creating parent directories if needed.",
    inputSchema: z.object({
      path: z.string().describe("The absolute path to write to"),
      content: z.string().describe("The content to write"),
    }),
    execute: async ({ path, content }): Promise<ToolResult> => {
      const permitted = await requestPermission("write", path);
      if (!permitted) {
        return { success: false, data: "", error: "Operation cancelled by user" };
      }
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf-8");
        return { success: true, data: `Successfully wrote ${content.length} bytes to ${path}` };
      } catch (err: unknown) {
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createEditTool() {
  return tool({
    description: "Replace first occurrence of oldString with newString in a file.",
    inputSchema: z.object({
      path: z.string().describe("The absolute path to the file to edit"),
      oldString: z.string().describe("Text to search for"),
      newString: z.string().describe("Replacement text"),
    }),
    execute: async ({ path, oldString, newString }): Promise<ToolResult> => {
      const permitted = await requestPermission("edit", path);
      if (!permitted) {
        return { success: false, data: "", error: "Operation cancelled by user" };
      }
      try {
        const content = await readFile(path, "utf-8");
        if (!content.includes(oldString)) {
          return { success: false, data: "", error: `String not found in file: ${oldString}` };
        }
        const updated = content.replace(oldString, newString);
        await writeFile(path, updated, "utf-8");
        return { success: true, data: "File updated successfully" };
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") {
          const resolved = await resolveUserPath(path);
          if (resolved && resolved.path !== path) {
            try {
              const content = await readFile(resolved.path, "utf-8");
              if (!content.includes(oldString)) {
                return { success: false, data: "", error: `String not found in file: ${oldString} (tried resolved path: ${resolved.path})` };
              }
              const updated = content.replace(oldString, newString);
              await writeFile(resolved.path, updated, "utf-8");
              return {
                success: true,
                data: `File updated successfully at resolved path: ${resolved.path}${resolved.note ? ` (${resolved.note})` : ""}`,
              };
            } catch { /* fall through */ }
          }
          return { success: false, data: "", error: `File not found: ${path}` };
        }
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createCommandTool(
  execOverride?: (command: string, timeout?: number) => Promise<{ stdout: string; stderr: string }>,
) {
  return tool({
    description: "Run a shell command and return its output. Max timeout 300s.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run"),
      timeout: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional().describe("Timeout in ms (max 300000)"),
    }),
    execute: async ({ command, timeout }): Promise<ToolResult> => {
      const permitted = await requestPermission("command", command);
      if (!permitted) {
        return { success: false, data: "", error: "Operation cancelled by user" };
      }

      // Route through exec override if provided (e.g., SSH)
      if (execOverride) {
        try {
          const result = await execOverride(command, timeout ?? MAX_TIMEOUT_MS);
          const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
          return { success: true, data: output || "(no output)" };
        } catch (err) {
          return { success: false, data: "", error: (err as Error).message };
        }
      }

      try {
        const safeTimeout = timeout ?? MAX_TIMEOUT_MS;
        const { stdout, stderr } = await execFileAsync(command, [], {
          shell: true,
          timeout: safeTimeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        const output = [stdout, stderr].filter(Boolean).join("\n");
        const condensed = detectAndCondense(output, command);
        return { success: true, data: (condensed ?? output) || "(no output)" };
      } catch (err: unknown) {
        if (err instanceof Error) {
          const nodeErr = err as NodeError;
          if (nodeErr.code === "ETIMEDOUT" || nodeErr.killed) {
            return { success: false, data: "", error: `Command timed out after ${timeout ?? MAX_TIMEOUT_MS}ms` };
          }
          const stderr = nodeErr.stderr ?? "";
          const stdout = nodeErr.stdout ?? "";
          const combined = [stdout, stderr].filter(Boolean).join("\n");
          const condensed = detectAndCondense(combined, command);
          return { success: false, data: condensed ?? combined, error: nodeErr.message };
        }
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createSearchTool() {
  return tool({
    description: "Search for files using a glob pattern.",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern (e.g. '**/*.ts')"),
    }),
    execute: async ({ pattern }): Promise<ToolResult> => {
      try {
        const files = await fastGlob(pattern, {
          ignore: ["node_modules/**", ".git/**", "dist/**"],
          dot: false,
          onlyFiles: true,
        });
        const data = files.length > 0 ? files.join("\n") : "No files found matching pattern";
        return { success: true, data };
      } catch (err: unknown) {
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createCrawlTool() {
  return tool({
    description: "Parse TypeScript files and trace their import dependency graph.",
    inputSchema: z.object({
      target: z.string().describe("File path or directory to crawl").default("src/"),
      mode: z.enum(["file", "directory"]).describe("Crawl a single file or an entire directory").default("directory"),
    }),
    execute: async ({ target, mode }): Promise<ToolResult> => {
      try {
        if (mode === "file") {
          const content = await readFile(resolve(target), "utf-8");
          const deps = crawlDependencies(resolve(target), content);
          const lines = deps.map((d) => {
            const resolved = d.resolvedPath ? ` → ${d.resolvedPath}` : " (external)";
            const spec = d.specifiers.length ? ` [${d.specifiers.join(", ")}]` : "";
            return `  ${d.source}${spec}${resolved}`;
          });
          return { success: true, data: `Dependencies of ${target}:\n${lines.join("\n")}` };
        } else {
          const graph = await crawlDirectory(resolve(target));
          const lines: string[] = [];
          for (const [file, deps] of Object.entries(graph)) {
            lines.push(`${file}:`);
            for (const dep of deps) {
              const resolved = dep.resolvedPath ? ` → ${dep.resolvedPath}` : " (external)";
              const spec = dep.specifiers.length ? ` [${dep.specifiers.join(", ")}]` : "";
              lines.push(`  ├─ ${dep.source}${spec}${resolved}`);
            }
          }
          return { success: true, data: lines.join("\n") || "No dependencies found." };
        }
      } catch (err: unknown) {
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

export function createBlastTool() {
  return tool({
    description: "Show all files that depend on a given file (reverse dependencies). Use before modifying a file to understand the blast radius.",
    inputSchema: z.object({
      target: z.string().describe("File path to check"),
    }),
    execute: async ({ target }): Promise<ToolResult> => {
      try {
        const resolved = resolve(target);
        const graph = await crawlDirectory("src/");
        const reverse = computeReverseDeps(graph, resolved);

        if (reverse.length === 0) {
          return { success: true, data: `No files import ${target} — zero blast radius.` };
        }

        const lines = reverse.map((f, i) => {
          const isLast = i === reverse.length - 1;
          return `${isLast ? "└──" : "├──"} ${f}`;
        });
        return {
          success: true,
          data: `⚠  Blast radius: ${reverse.length} file(s) import ${target}\n${lines.join("\n")}\n\nReview these files if you change ${target}'s public API.`,
        };
      } catch (err: unknown) {
        return { success: false, data: "", error: toErrorMessage(err) };
      }
    },
  });
}

interface NodeError extends Error {
  code?: string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && "code" in err;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Tool registration with mode system
// ---------------------------------------------------------------------------

import { registerTool } from "./mode.js";

registerTool("read", "core");
registerTool("write", "core");
registerTool("edit", "core");
registerTool("command", "core");
registerTool("search", "core");
registerTool("crawl", "core");
registerTool("patch", "core");
registerTool("blast", "core");
registerTool("subagent", "core");
