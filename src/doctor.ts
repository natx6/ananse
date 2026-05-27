import picocolors from "picocolors";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const CONFIG_PATH = join(homedir(), ".ananse", "config.json");
const SESSIONS_DIR = join(homedir(), ".ananse", "sessions");

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];

  // Node version
  const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
  checks.push({
    name: "Node.js version",
    status: nodeMajor >= 18 ? "ok" : "fail",
    message: `${process.version} (${nodeMajor >= 18 ? "OK" : "need >=18"})`,
  });

  // Config file
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);
      checks.push({
        name: "Config file",
        status: "ok",
        message: `~/.ananse/config.json (${Object.keys(config).length} keys)`,
      });
      if (config.apiKey) {
        const key = config.apiKey as string;
        const masked = key.length > 8 ? key.slice(0, 8) + "…" + key.slice(-4) : key;
        checks.push({
          name: "API key",
          status: "ok",
          message: `${config.provider ?? "?"}: ${masked}`,
        });
      } else {
        checks.push({
          name: "API key",
          status: "fail",
          message: "not set — run `ananse configure`",
        });
      }
    } catch {
      checks.push({ name: "Config file", status: "fail", message: "invalid JSON" });
    }
  } else {
    checks.push({ name: "Config file", status: "fail", message: "not found — run `ananse configure`" });
  }

  // Git
  try {
    const gitDir = execSync("git rev-parse --git-dir 2>/dev/null", { encoding: "utf-8" }).trim();
    const branch = execSync("git branch --show-current 2>/dev/null", { encoding: "utf-8" }).trim();
    const remote = execSync("git config remote.origin.url 2>/dev/null", { encoding: "utf-8" }).trim();
    checks.push({
      name: "Git repository",
      status: gitDir ? "ok" : "fail",
      message: gitDir ? `${branch} @ ${remote || "no remote"}` : "not a git repo",
    });
  } catch {
    checks.push({ name: "Git repository", status: "warn", message: "not available" });
  }

  // Sessions directory
  if (existsSync(SESSIONS_DIR)) {
    const entries = await readFile(SESSIONS_DIR, "utf-8").catch(() => "");
    const count = entries ? entries.split("\n").filter((l) => l.endsWith(".json")).length : 0;
    checks.push({
      name: "Session storage",
      status: "ok",
      message: `~/.ananse/sessions/ (${count} files)`,
    });
  } else {
    checks.push({ name: "Session storage", status: "warn", message: "not yet created" });
  }

  // Project personality
  const hasPersonality = existsSync(".ananse.md");
  checks.push({
    name: "Project personality",
    status: hasPersonality ? "ok" : "warn",
    message: hasPersonality ? ".ananse.md found" : "none — run `ananse init`",
  });

  // Print results
  console.log(picocolors.cyan("\n  ╭── Doctor ──"));
  for (const check of checks) {
    const icon = check.status === "ok" ? picocolors.green("✓") : check.status === "warn" ? picocolors.yellow("!") : picocolors.red("✗");
    const label = check.status === "ok" ? picocolors.green(check.name) : check.status === "warn" ? picocolors.yellow(check.name) : picocolors.red(check.name);
    console.log(`  ├ ${icon} ${label}`);
    console.log(`  │  ${picocolors.dim(check.message)}`);
  }
  console.log(`  └──\n`);
}
