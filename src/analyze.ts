import { tool } from "ai";
import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { registerTool } from "./mode.js";
import { resolveUserPath } from "./pathResolver.js";
import type { ToolResult } from "./types.js";

/**
 * Analyze a directory or project and describe what it is.
 * Reads key files (package.json, README, Dockerfile, etc.)
 * and builds a summary of the project's purpose and structure.
 */
export function createAnalyzeTool() {
  return tool({
    description: "Analyze a directory or project and return a summary of what it is — language, framework, purpose, structure. Use this when the user asks what a project, directory, or codebase is about.",
    inputSchema: z.object({
      path: z.string().describe("Path to the directory or project to analyze"),
    }),
    execute: async ({ path }): Promise<ToolResult> => {
      try {
        const resolved = await resolveUserPath(path);
        const dir = resolved?.path ?? resolve(path);

        if (!existsSync(dir)) {
          return { success: false, data: "", error: `Path not found: ${path}` };
        }

        const entries = await readdir(dir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile()).map((e) => e.name);
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const lines: string[] = [];
        lines.push(`Directory: ${dir}`);

        // Detect project type from key files
        const hasPackageJson = files.includes("package.json");
        const hasGoMod = files.includes("go.mod");
        const hasCargoToml = files.includes("Cargo.toml");
        const hasPyProject = files.includes("pyproject.toml") || files.includes("requirements.txt");
        const hasGemfile = files.includes("Gemfile");
        const hasDockerfile = files.includes("Dockerfile");
        const hasReadme = files.includes("README.md") || files.includes("README");

        let language = "unknown";
        let framework = "";
        if (hasPackageJson) language = "TypeScript / JavaScript (Node.js)";
        else if (hasGoMod) language = "Go";
        else if (hasCargoToml) language = "Rust";
        else if (hasPyProject) language = "Python";
        else if (hasGemfile) language = "Ruby";

        // Read package.json for details
        if (hasPackageJson) {
          try {
            const raw = await readFile(resolve(dir, "package.json"), "utf-8");
            const pkg = JSON.parse(raw);
            if (pkg.name) lines.push(`Name: ${pkg.name}`);
            if (pkg.description) lines.push(`Description: ${pkg.description}`);
            if (pkg.version) lines.push(`Version: ${pkg.version}`);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const depNames = Object.keys(deps);
            if (depNames.length > 0) {
              lines.push(`Dependencies: ${depNames.length} packages`);
              if (deps.next) framework = "Next.js";
              else if (deps["@nestjs/core"]) framework = "NestJS";
              else if (deps.react || deps["react-dom"]) framework = "React";
              else if (deps.vue) framework = "Vue";
              else if (deps.express) framework = "Express";
              else if (deps["typeorm"]) framework = "TypeORM";
            }
          } catch { /* ignore parse errors */ }
        }

        // Read go.mod
        if (hasGoMod) {
          try {
            const raw = await readFile(resolve(dir, "go.mod"), "utf-8");
            const firstLine = raw.split("\n")[0];
            if (firstLine) lines.push(`Module: ${firstLine.replace("module ", "")}`);
            // Check for common Go frameworks
            if (raw.includes("gin-gonic/gin")) framework = "Gin";
            else if (raw.includes("gorilla/mux")) framework = "Gorilla Mux";
            else if (raw.includes("fiber")) framework = "Fiber";
          } catch { /* ignore */ }
        }

        // Read pyproject.toml
        if (hasPyProject) {
          try {
            const raw = await readFile(resolve(dir, "pyproject.toml"), "utf-8");
            if (raw.includes("django")) framework = "Django";
            else if (raw.includes("flask")) framework = "Flask";
            else if (raw.includes("fastapi")) framework = "FastAPI";
          } catch { /* ignore */ }
        }

        // Read first 5 lines of README
        if (hasReadme) {
          const readmeFile = files.find((f) => f.toLowerCase().startsWith("readme"))!;
          try {
            const raw = await readFile(resolve(dir, readmeFile), "utf-8");
            const firstLines = raw.split("\n").slice(0, 5).filter((l) => l.trim() && !l.startsWith("#")).join("\n").trim();
            if (firstLines) lines.push(`README: ${firstLines.slice(0, 200)}`);
          } catch { /* ignore */ }
        }

        // File counts by extension
        const exts: Record<string, number> = {};
        await countFiles(dir, exts, 0);
        const extSummary = Object.entries(exts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([ext, count]) => `${ext} (${count})`)
          .join(", ");
        if (extSummary) lines.push(`File types: ${extSummary}`);

        // Summary
        const parts: string[] = [];
        parts.push(`Language: ${language}`);
        if (framework) parts.push(`Framework: ${framework}`);
        if (hasDockerfile) parts.push("Containerized (Docker)");
        parts.push(`${files.length} files, ${dirs.length} subdirectories`);

        lines.push("");
        lines.push(`Summary: ${parts.join(" | ")}`);

        return { success: true, data: lines.join("\n") };
      } catch (err) {
        return { success: false, data: "", error: String(err) };
      }
    },
  });
}

async function countFiles(dir: string, exts: Record<string, number>, depth: number): Promise<void> {
  if (depth > 3) return;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await countFiles(full, exts, depth + 1);
      } else if (entry.isFile()) {
        const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : "no-ext";
        exts[`.${ext}`] = (exts[`.${ext}`] ?? 0) + 1;
      }
    }
  } catch { /* skip unreadable */ }
}

registerTool("analyze", "core");
