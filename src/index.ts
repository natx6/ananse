#!/usr/bin/env node

import picocolors from "picocolors";
import { Command } from "commander";
import { spinner, text, select, isCancel } from "@clack/prompts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { LOGO, TAGLINE } from "./branding.js";
import { checkConfig, scanDirectory } from "./utils.js";
import { loadPersonality } from "./personality.js";
import { dangerousMode, setDangerousMode } from "./permission.js";
import { runAgentLoop } from "./agent.js";
import { runBuildLoop } from "./builder.js";
import { runRefactor } from "./refactor.js";
import { weaveTypes, weaveDocs } from "./weave.js";
import { crawlDirectory, formatGraph } from "./cobweb.js";
import { sortDirectory } from "./sorter.js";
import { generatePatches, applyPatches } from "./patch.js";
import {
  listSessions,
  listNamedSessions,
  loadSessionByName,
  createSession,
  saveSession,
  renameSession,
  deleteSession,
} from "./session.js";

const CONFIG_DIR = `${homedir()}/.ananse`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

async function readConfigFile(): Promise<Record<string, string>> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

async function writeConfigFile(config: Record<string, string | undefined>): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v !== undefined) clean[k] = v;
  }
  await writeFile(CONFIG_PATH, JSON.stringify(clean, null, 2), "utf-8");
}

async function resolveUserName(config: Record<string, string>): Promise<string | null> {
  if (config.userName) return config.userName;

  // try git
  try {
    const name = execSync("git config user.name", { encoding: "utf-8" }).trim();
    if (name) {
      config.userName = name;
      await writeConfigFile(config);
      return name;
    }
  } catch { /* not in a git repo or no name set */ }

  // ask
  const name = await text({
    message: "What's your name?",
    placeholder: "e.g., Alex",
    validate: (v) => (v && v.trim() ? undefined : "Name is required"),
  });

  if (isCancel(name)) process.exit(0);

  config.userName = name.trim();
  await writeConfigFile(config);
  return config.userName;
}

async function barePrompt(): Promise<string | symbol> {
  const rl = readline.createInterface({ input: processStdin, output: processStdout });
  try {
    const answer = await rl.question(picocolors.green("> "));
    return answer;
  } catch {
    console.log(picocolors.yellow("\nGoodbye."));
    process.exit(0);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  console.clear();
  console.log(picocolors.white(LOGO));
  console.log(picocolors.dim(`  ${TAGLINE}`));

  const s = spinner();
  s.start("Weaving local context...");

  s.message("Weaving local context... checking config");
  const config = await checkConfig();

  s.message("Weaving local context... reading project personality");
  const personality = await loadPersonality();

  s.message("Weaving local context... scanning project files");
  const fileCount = await scanDirectory();

  s.stop(picocolors.green("Context woven successfully"));

  if (dangerousMode) {
    console.log(picocolors.red(`  ${"═".repeat(46)}`));
    console.log(picocolors.bold(picocolors.red("  ⚠  DANGEROUS MODE")));
    console.log(picocolors.red("  Permission prompts are disabled."));
    console.log(picocolors.red("  The agent can run ANY command and modify ANY file."));
    console.log(picocolors.red(`  ${"═".repeat(46)}`));
  }

  console.log("");

  const summaryParts: string[] = [];
  summaryParts.push(
    `provider: ${config?.provider ?? picocolors.dim("not set")}`,
  );
  summaryParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"} in scope`);
  console.log(picocolors.dim(`  ${summaryParts.join(" | ")}`));
  console.log("");

  // resolve user name (git → ask → persist)
  const flatConfig = await readConfigFile();
  const userName = await resolveUserName(flatConfig);

  let firstTurn = true;
  let currentSession = createSession(config ?? {}, personality, fileCount);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: string | symbol;

    if (firstTurn) {
      response = await text({
        message: "How can I help?",
        placeholder: "Build something, refactor, debug, explore...",
      });
      firstTurn = false;
    } else {
      response = await barePrompt();
    }

    if (isCancel(response) || response === undefined) {
      console.log(picocolors.yellow("\nGoodbye."));
      process.exit(0);
    }

    if (typeof response !== "string" || !response.trim()) continue;

    const input = response.trim();

    // Handle slash commands
    if (input.startsWith("/")) {
      const [cmd, ...args] = input.slice(1).split(/\s+/);
      switch (cmd) {
        case "help":
          console.log(picocolors.cyan("\n  Slash commands:"));
          console.log(`  ${picocolors.dim("/help")}       Show this help`);
          console.log(`  ${picocolors.dim("/model")}     Change AI model (e.g., /model gpt-4o)`);
          console.log(`  ${picocolors.dim("/clear")}     Clear conversation history`);
          console.log(`  ${picocolors.dim("/save")}     Save session with a name`);
          console.log(`  ${picocolors.dim("/status")}   Show session info`);
          console.log(`  ${picocolors.dim("/danger")}   Toggle dangerous mode`);
          console.log(`  ${picocolors.dim("/exit")}     Exit Ananse\n`);
          break;
        case "model":
          if (args.length === 0) {
            console.log(picocolors.yellow(`\n  Current model: ${picocolors.white(config?.model ?? "default")}\n`));
          } else {
            const newModel = args.join(" ");
            if (flatConfig) {
              flatConfig.model = newModel;
              await writeConfigFile(flatConfig);
            }
            console.log(picocolors.green(`\n  Model switched to: ${picocolors.white(newModel)}\n`));
          }
          break;
        case "clear": {
          currentSession = createSession(config ?? {}, personality, fileCount);
          console.log(picocolors.yellow("\n  Conversation cleared.\n"));
          break;
        }
        case "save": {
          const name = args.join(" ");
          if (name) {
            currentSession.name = name;
            await saveSession(currentSession);
            console.log(picocolors.green(`\n  Saved as: ${picocolors.cyan(name)}\n`));
          } else {
            const asked = await text({ message: "Session name:", placeholder: "my-session" });
            if (!isCancel(asked) && asked.trim()) {
              currentSession.name = asked.trim();
              await saveSession(currentSession);
              console.log(picocolors.green(`\n  Saved as: ${picocolors.cyan(asked.trim())}\n`));
            }
          }
          break;
        }
        case "status": {
          const msgs = currentSession.messages.length;
          const roleCounts = currentSession.messages.reduce((acc, m) => {
            acc[m.role] = (acc[m.role] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          console.log(picocolors.cyan(`\n  Session: ${currentSession.name ?? picocolors.dim("unnamed")}`));
          console.log(`  Model:   ${config?.model ?? picocolors.dim("default")}`);
          console.log(`  Provider: ${config?.provider ?? picocolors.dim("not set")}`);
          console.log(`  Messages: ${picocolors.white(String(msgs))} total`);
          for (const [role, count] of Object.entries(roleCounts)) {
            console.log(`    ${role}: ${count}`);
          }
          console.log(`  Danger:  ${dangerousMode ? picocolors.red("ON") : picocolors.dim("OFF")}`);
          console.log("");
          break;
        }
        case "danger":
          setDangerousMode(!dangerousMode);
          console.log(picocolors.red(`\n  Dangerous mode: ${dangerousMode ? "ON" : "OFF"}\n`));
          break;
        case "exit":
        case "quit":
          console.log(picocolors.yellow("\nGoodbye."));
          process.exit(0);
        default:
          console.log(picocolors.yellow(`\n  Unknown command: /${cmd}. Try /help\n`));
      }
      continue;
    }

    console.log(picocolors.green(`You: ${input}`));
    const updatedSession = await runAgentLoop(
      input, config ?? {}, personality, fileCount, userName, currentSession,
    );
    if (updatedSession) {
      // Auto-name the session from the first user message
      if (!updatedSession.name && updatedSession.messages.length > 0) {
        updatedSession.name = input.length > 55
          ? input.slice(0, 52).replace(/\s+\S*$/, "") + "…"
          : input;
        await saveSession(updatedSession);
      }
      currentSession = updatedSession;
    }
    console.log("");
  }
}

async function configure(): Promise<void> {
  const configDir = `${homedir()}/.ananse`;
  const configPath = `${configDir}/config.json`;

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  let existing: Record<string, string> = {};
  try {
    if (existsSync(configPath)) {
      existing = JSON.parse(await readFile(configPath, "utf-8"));
    }
  } catch { /* ignore */ }

  const provider = await select({
    message: "Select an AI provider:",
    options: [
      { value: "anthropic", label: "Anthropic" },
      { value: "openai", label: "OpenAI" },
      { value: "google", label: "Google (Gemini)" },
      { value: "xai", label: "xAI (Grok)" },
      { value: "deepseek", label: "DeepSeek" },
      { value: "mistral", label: "Mistral" },
    ],
    initialValue: (existing.provider as "anthropic" | "openai" | "google" | "xai" | "deepseek" | "mistral") ?? "anthropic",
  });

  if (isCancel(provider)) process.exit(0);

  const apiKey = await text({
    message: "Enter your API key:",
    placeholder: "sk-...",
    initialValue: existing.apiKey ?? "",
    validate: (v) => (v ? undefined : "API key is required"),
  });

  if (isCancel(apiKey)) process.exit(0);

  const model = await text({
    message: "Model (optional — press Enter for default):",
    placeholder: provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "openai" ? "gpt-4o" : provider === "google" ? "gemini-2.0-flash" : provider === "xai" ? "grok-2-1212" : provider === "deepseek" ? "deepseek-chat" : "mistral-large-latest",
    initialValue: existing.model ?? "",
  });

  if (isCancel(model)) process.exit(0);

  const baseURL = await text({
    message: "Base URL (optional — press Enter to skip):",
    placeholder: "https://api.openai.com/v1",
    initialValue: existing.baseURL ?? "",
  });

  if (isCancel(baseURL)) process.exit(0);

  const config: Record<string, string | undefined> = {
    provider,
    apiKey,
    model: model || undefined,
    baseURL: baseURL || undefined,
  };
  // remove undefined keys
  for (const k of Object.keys(config)) {
    if (config[k] === undefined) delete config[k];
  }
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

  console.log(picocolors.green(`\nConfig saved to ~/.ananse/config.json`));
}

async function initPersonality(): Promise<void> {
  const path = `${process.cwd()}/.ananse.md`;
  if (existsSync(path)) {
    console.log(picocolors.yellow(".ananse.md already exists in this directory."));
    return;
  }

  // Auto-detect project stack
  let language = "";
  let framework = "";
  let testTool = "";
  let pkgManager = "";

  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(await readFile("package.json", "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      language = "TypeScript / JavaScript";

      if (deps.next) framework = "Next.js";
      else if (deps.react || deps["react-dom"]) framework = "React";
      else if (deps.vue) framework = "Vue";
      else if (deps.express) framework = "Express";

      if (deps.vitest) testTool = "Vitest";
      else if (deps.jest) testTool = "Jest";
      else if (deps.ava) testTool = "AVA";
      else if (deps.mocha) testTool = "Mocha";

      pkgManager = existsSync("pnpm-lock.yaml") ? "pnpm"
        : existsSync("yarn.lock") ? "yarn"
        : existsSync("bun.lock") ? "bun"
        : "npm";
    } catch { /* ignore parse errors */ }
  } else if (existsSync("Cargo.toml")) {
    language = "Rust";
    pkgManager = "cargo";
  } else if (existsSync("pyproject.toml") || existsSync("requirements.txt")) {
    language = "Python";
    pkgManager = existsSync("uv.lock") ? "uv" : "pip";
  } else if (existsSync("go.mod")) {
    language = "Go";
    pkgManager = "go mod";
  } else if (existsSync("Gemfile")) {
    language = "Ruby";
    pkgManager = "bundler";
  }

  const autoDetected = [
    language ? `- Language: ${language}` : null,
    framework ? `- Framework: ${framework}` : null,
    testTool ? `- Testing: ${testTool}` : null,
    pkgManager ? `- Package manager: ${pkgManager}` : null,
  ].filter(Boolean).join("\n");

  const stackSection = autoDetected
    ? `## Stack\n\n${autoDetected}\n`
    : `## Stack\n\n- Language: (e.g., TypeScript, Python, Rust)\n- Framework: (e.g., React, Next.js, Django)\n- Testing: (e.g., Vitest, pytest)\n- Package manager: (e.g., npm, pip, cargo)\n`;

  const template = `# Project Personality

This file tells Ananse about your project's conventions, stack, and preferences.

${stackSection}
## Conventions

- (e.g., use functional components, prefer async/await, naming conventions)

## Preferences

- (e.g., prefer simple solutions over abstractions, focused PRs)
`;

  await writeFile(path, template, "utf-8");
  console.log(picocolors.green("Created .ananse.md"));
  if (language) {
    console.log(picocolors.dim(`  Detected: ${language}${framework ? ` + ${framework}` : ""}${testTool ? ` + ${testTool}` : ""}`));
  } else {
    console.log(picocolors.dim("  Edit it to describe your project's conventions."));
  }
}

async function sessionsCommand(): Promise<void> {
  const all = await listSessions();
  // Filter out sessions with 0 messages — they're empty shells from spin
  const sessions = all.filter((s) => s.messages.length > 0);
  if (sessions.length === 0) {
    console.log(picocolors.yellow("\n  No conversation sessions yet. Start one with `ananse`."));
    console.log("");
    return;
  }

  // Group: named sessions first, then unnamed
  const named = sessions.filter((s) => s.name);
  const unnamed = sessions.filter((s) => !s.name);

  const options: { value: string; label: string }[] = [];

  if (named.length > 0) {
    for (const s of named) {
      const date = new Date(s.updatedAt).toLocaleString();
      const msgs = s.messages.length;
      const lastPreview = [...s.messages].reverse().find((m) => m.role === "user")?.content.slice(0, 55) ?? "";
      options.push({
        value: s.id,
        label: `${picocolors.cyan(s.name!)}  ${picocolors.dim(`${msgs} msgs`)}  ${picocolors.dim(date)}`,
      });
    }
  }

  if (unnamed.length > 0) {
    for (const s of unnamed) {
      const date = new Date(s.updatedAt).toLocaleString();
      const msgs = s.messages.length;
      const preview = s.messages.find((m) => m.role === "user")?.content.slice(0, 55) ?? "";
      options.push({
        value: s.id,
        label: `${picocolors.dim(preview)}  ${picocolors.dim(`${msgs} msgs`)}  ${picocolors.dim(date)}`,
      });
    }
  }

  const picked = await select({
    message: "Select a session:",
    options,
  });

  if (isCancel(picked)) return;

  const session = sessions.find((s) => s.id === picked);
  if (!session) return;

  console.log(picocolors.cyan(`\n  ─── ${session.name ?? "Session"} ───`));
  for (const msg of session.messages) {
    const role = msg.role === "user" ? picocolors.green("you") : msg.role === "assistant" ? picocolors.blue("anse") : picocolors.yellow("tool");
    const content = msg.content.slice(0, 250);
    console.log(`  ${role}: ${picocolors.dim(content)}`);
  }
  console.log("");
}

const program = new Command()
  .name("ananse")
  .description("AI agent for coding tasks")
  .version("0.1.0")
  .option("-d, --dangerously-skip-permissions", "Skip all permission prompts (use with care)")
  .hook("preAction", (thisCmd) => {
    const opts = thisCmd.optsWithGlobals();
    if (opts.dangerouslySkipPermissions) {
      setDangerousMode(true);
    }
  })
  .action(main);

program
  .command("status")
  .description("Check API status, config, and session storage")
  .action(async () => {
    const config = await readConfigFile();
    const sessions = await listSessions();
    const namedSessions = await listNamedSessions();
    const totalMsgs = sessions.reduce((sum, s) => sum + s.messages.length, 0);
    const avgMsgs = sessions.length ? Math.round(totalMsgs / sessions.length) : 0;

    // System
    console.log(picocolors.cyan("\n  ╭── System ──"));
    console.log(`  ├── ${picocolors.bold("Ananse")}    v0.1.0`);
    console.log(`  ├── Node.js   ${picocolors.white(process.version)}`);
    console.log(`  ├── Platform  ${picocolors.white(`${process.platform}/${process.arch}`)}`);

    try {
      const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
      const commit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
      const remote = execSync("git config remote.origin.url", { encoding: "utf-8" }).trim();
      console.log(`  ├── Git       ${picocolors.white(branch)} @ ${picocolors.dim(commit)}`);
      console.log(`  ├── Remote    ${picocolors.dim(remote)}`);
    } catch {
      console.log(`  ├── Git       ${picocolors.dim("not a git repo")}`);
    }
    console.log(`  └── Danger    ${dangerousMode ? picocolors.red("ON") : picocolors.dim("OFF")}`);

    // Config
    console.log(picocolors.cyan("\n  ╭── Config ──"));
    console.log(`  ├── Provider  ${picocolors.white(config.provider ?? picocolors.dim("not set"))}`);
    console.log(`  ├── Model     ${picocolors.white(config.model ?? picocolors.dim("default"))}`);
    console.log(`  ├── Endpoint  ${picocolors.dim(config.baseURL ?? "(default)")}`);
    if (config.apiKey) {
      const key = config.apiKey;
      const masked = key.length > 16
        ? key.slice(0, 12) + picocolors.dim("…") + key.slice(-4)
        : key.slice(0, 8) + picocolors.dim("…");
      console.log(`  ├── API Key   ${picocolors.green(masked)}`);
    } else {
      console.log(`  ├── API Key   ${picocolors.red("not set")}`);
    }
    if (config.userName) {
      console.log(`  └── User      ${picocolors.white(config.userName)}`);
    } else {
      console.log(`  └── User      ${picocolors.dim("not set")}`);
    }

    // Storage
    console.log(picocolors.cyan("\n  ╭── Storage ──"));
    console.log(`  ├── Sessions  ${picocolors.white(String(sessions.length))} total (${picocolors.white(String(namedSessions.length))} named)`);
    console.log(`  ├── Messages  ${picocolors.white(String(totalMsgs))} total, ${picocolors.white(String(avgMsgs))} avg/session`);
    if (sessions.length > 0) {
      const latest = new Date(sessions[0].updatedAt).toLocaleString();
      console.log(`  ├── Latest    ${picocolors.dim(latest)}`);
    }
    try {
      const du = execSync("du -sh ~/.ananse/sessions 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();
      if (du) console.log(`  └── Disk      ${picocolors.dim(du.split(/\s+/)[0])}`);
    } catch {
      console.log(`  └── Disk      ${picocolors.dim("?")}`);
    }

    // Project
    console.log(picocolors.cyan("\n  ╭── Project ──"));
    const fileCount = await scanDirectory();
    console.log(`  ├── Files       ${picocolors.white(String(fileCount))} in scope`);
    const hasPersonality = existsSync(".ananse.md");
    console.log(`  └── Personality ${hasPersonality ? picocolors.green(".ananse.md found") : picocolors.dim("none")}`);

    // API Check
    if (config.apiKey) {
      console.log(picocolors.cyan("\n  ╭── API Check ──"));
      const defaultEndpoints: Record<string, string> = {
        anthropic: "https://api.anthropic.com/v1",
        openai: "https://api.openai.com/v1",
        google: "https://generativelanguage.googleapis.com/v1beta",
        xai: "https://api.x.ai/v1",
        deepseek: "https://api.deepseek.com/v1",
        mistral: "https://api.mistral.ai/v1",
      };
      const base = config.baseURL || defaultEndpoints[config.provider ?? ""];
      if (base) {
        try {
          const modelsUrl = base.replace(/\/+$/, "") + "/models";
          const res = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            const data = await res.json() as { data?: unknown[] };
            console.log(`  ├── Status    ${picocolors.green("connected")}`);
            console.log(`  ├── Endpoint  ${picocolors.dim(base)}`);
            if (data.data) console.log(`  ├── Models    ${picocolors.white(String(data.data.length))} available`);
            const remaining = res.headers.get("x-ratelimit-remaining")
              ?? res.headers.get("ratelimit-remaining")
              ?? res.headers.get("x-ratelimit-limit");
            if (remaining) console.log(`  └── Rate limit ${picocolors.yellow(remaining)} remaining`);
            else console.log(`  └── Rate limit ${picocolors.dim("unknown")}`);
          } else {
            console.log(`  ├── Status    ${picocolors.red(`HTTP ${res.status}`)}`);
            console.log(`  └── Endpoint  ${picocolors.dim(base)}`);
          }
        } catch {
          console.log(`  ├── Status    ${picocolors.red("unreachable")}`);
          console.log(`  └── Endpoint  ${picocolors.dim(base)}`);
        }
      } else {
        console.log(`  └── Status    ${picocolors.dim("unknown endpoint for this provider")}`);
      }
    }

    console.log("");
  });

program
  .command("configure")
  .description("Set up your AI provider and API key")
  .action(configure);

program
  .command("init")
  .description("Generate a starter .ananse.md personality file")
  .action(initPersonality);

program
  .command("sessions")
  .description("List and browse past conversation sessions")
  .action(sessionsCommand);

// Tier 2 commands
program
  .command("web")
  .description("Trace the import dependency graph of a directory")
  .argument("[path]", "Directory to crawl", "src/")
  .action(async (path: string) => {
    console.log(picocolors.cyan(`\n  Crawling ${picocolors.dim(path)} for dependencies...\n`));
    const graph = await crawlDirectory(path);
    console.log(formatGraph(graph));
  });

program
  .command("build")
  .description("Run a build command with automatic error fixing")
  .argument("<command>", "Build command to execute")
  .action(async (command: string) => {
    const config = await readConfigFile();
    await runBuildLoop(command, config as any);
  });

program
  .command("commit")
  .description("Stage all files and create a git commit")
  .argument("<message>", "Commit message")
  .action(async (message: string) => {
    try {
      execSync("git add -A", { encoding: "utf-8" });
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { encoding: "utf-8" });
      console.log(picocolors.green(`\n  Committed: ${picocolors.white(message)}`));
    } catch (e) {
      const err = e as Error;
      console.log(picocolors.red(`\n  ${err.message}`));
    }
  });

program
  .command("pr")
  .description("Create a GitHub pull request")
  .argument("<title>", "PR title")
  .action(async (title: string) => {
    try {
      const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
      execSync("git add -A", { encoding: "utf-8" });
      try {
        execSync(`git commit -m "${title.replace(/"/g, '\\"')}"`, { encoding: "utf-8" });
      } catch { /* nothing to commit */ }
      const remote = execSync("git config remote.origin.url", { encoding: "utf-8" }).trim();
      if (!remote) { console.log(picocolors.red("\n  No remote configured.")); return; }
      execSync(`git push -u origin ${branch}`, { encoding: "utf-8" });
      const url = execSync(
        `gh pr create --title "${title.replace(/"/g, '\\"')}" --body ""`,
        { encoding: "utf-8" },
      ).trim();
      console.log(picocolors.green(`\n  PR created: ${picocolors.cyan(url)}`));
    } catch (e) {
      const err = e as Error;
      console.log(picocolors.red(`\n  ${err.message}`));
    }
  });

program
  .command("spin")
  .description("Create a new named session")
  .argument("<name>", "Session name")
  .action(async (name: string) => {
    const config = await readConfigFile();
    const session = createSession(config as any, null, 0, name);
    await saveSession(session);
    console.log(picocolors.green(`\n  Spun new session: ${picocolors.cyan(name)} (${session.id})`));
  });

program
  .command("stash")
  .description("Save the current conversation session")
  .action(async () => {
    const config = await readConfigFile();
    const sessions = await listNamedSessions();
    if (sessions.length === 0) {
      console.log(picocolors.yellow("No sessions to stash."));
      return;
    }
    // Save the most recent session
    await saveSession(sessions[0]);
    console.log(picocolors.green(`\n  Stashed session: ${picocolors.cyan(sessions[0].name ?? sessions[0].id)}`));
  });

program
  .command("pop")
  .description("Restore a named session")
  .argument("[name]", "Session name (defaults to most recent)")
  .action(async (name?: string) => {
    if (name) {
      const session = await loadSessionByName(name);
      if (!session) {
        console.log(picocolors.yellow(`\n  No session found: "${name}"`));
        return;
      }
      console.log(picocolors.cyan(`\n  Restored: ${name} (${session.messages.length} messages)`));
    } else {
      const sessions = await listNamedSessions();
      if (sessions.length === 0) {
        console.log(picocolors.yellow("No sessions found."));
        return;
      }
      const s = sessions[0];
      console.log(picocolors.cyan(`\n  Latest session: ${s.name ?? s.id} (${s.messages.length} messages)`));
    }
  });

program
  .command("rename")
  .description("Rename a session")
  .argument("<name>", "Current session name")
  .argument("<new-name>", "New session name")
  .action(async (name: string, newName: string) => {
    const ok = await renameSession(name, newName);
    if (ok) {
      console.log(picocolors.green(`\n  Renamed: ${picocolors.white(name)} → ${picocolors.white(newName)}`));
    } else {
      console.log(picocolors.yellow(`\n  No session found: "${name}"`));
    }
  });

program
  .command("rm")
  .description("Delete a session by name or ID")
  .argument("<name>", "Session name or ID")
  .action(async (name: string) => {
    const ok = await deleteSession(name);
    if (ok) {
      console.log(picocolors.green(`\n  Deleted session: ${picocolors.white(name)}`));
    } else {
      console.log(picocolors.yellow(`\n  No session found: "${name}"`));
    }
  });

program
  .command("refactor")
  .description("Analyze blast radius and refactor with AI")
  .argument("<file>", "Target file to refactor")
  .argument("[description]", "What to refactor (omit for interactive prompt)")
  .action(async (file: string, description?: string) => {
    const config = await readConfigFile();
    await runRefactor(file, description, config as any);
  });

program
  .command("checkpoint")
  .description("Stash uncommitted changes")
  .argument("<name>", "Checkpoint name")
  .action(async (name: string) => {
    try {
      const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
      if (!status) {
        console.log(picocolors.yellow("\n  Nothing to stash — working tree is clean."));
        return;
      }
      execSync(`git stash push -m "ananse: ${name}"`, { encoding: "utf-8" });
      const count = status.split("\n").length;
      console.log(picocolors.green(`\n  Stashed ${picocolors.white(String(count))} file${count === 1 ? "" : "s"} as "${picocolors.cyan(name)}"`));
    } catch (e) {
      console.log(picocolors.red(`\n  ${(e as Error).message}`));
    }
  });

program
  .command("switch")
  .description("Stash current work and switch branches")
  .argument("<branch>", "Branch to switch to")
  .action(async (branch: string) => {
    try {
      // Auto-stash if dirty
      const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
      if (status) {
        const ts = Math.floor(Date.now() / 1000);
        execSync(`git stash push -m "ananse: auto-${ts}"`, { encoding: "utf-8" });
        console.log(picocolors.dim(`  Stashed ${status.split("\n").length} file(s) before switching`));
      }
      execSync(`git checkout ${branch}`, { encoding: "utf-8" });
      console.log(picocolors.green(`\n  Switched to ${picocolors.white(branch)}`));
    } catch (e) {
      console.log(picocolors.red(`\n  ${(e as Error).message}`));
    }
  });

program
  .command("sort")
  .description("Sort files into categorized folders")
  .argument("[path]", "Directory to sort")
  .action(async (path?: string) => {
    const dir = path ?? join(homedir(), "Downloads");
    await sortDirectory(dir);
  });

program
  .command("patch")
  .description("Generate and apply precision code patches via AI")
  .argument("<file>", "File to patch")
  .argument("<description>", "What change to make")
  .action(async (file: string, description: string) => {
    const config = await readConfigFile();
    console.log(picocolors.dim("\n  Generating patches...\n"));
    const patches = await generatePatches(file, description, config as any);
    if (patches.length === 0) {
      console.log(picocolors.yellow("  No patches generated.\n"));
      return;
    }
    console.log(`  ${picocolors.cyan(`Generated ${patches.length} patch(es)`)}\n`);
    const { results } = await applyPatches(patches);
    for (const r of results) {
      console.log(`  ${r.startsWith("✓") ? picocolors.green(r) : picocolors.red(r)}`);
    }
    console.log("");
  });

program
  .command("weave")
  .description("Generate structured output from source files")
  .addCommand(
    new Command("types")
      .description("Extract type definitions from a file")
      .argument("<path>", "File path")
      .action(async (path: string) => {
        const config = await readConfigFile();
        await weaveTypes(path, config as any);
      }),
  )
  .addCommand(
    new Command("docs")
      .description("Generate documentation from a file")
      .argument("<path>", "File path")
      .action(async (path: string) => {
        const config = await readConfigFile();
        await weaveDocs(path, config as any);
      }),
  );

program
  .command("completions")
  .description("Generate shell completion script")
  .argument("[shell]", "Shell type (bash or zsh)", "bash")
  .action((shell: string) => {
    const cmds = program.commands.map((c) => c.name()).filter((n) => n !== "completions");
    const script = shell === "zsh" ? `#compdef ananse
_ananse() {
  compadd ${cmds.join(" ")} ${cmds.map((c) => c).join(" ")} status configure init sessions web build spin stash pop weave
}
compdef _ananse ananse
` : `_ananse_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local prev=\${COMP_WORDS[COMP_CWORD-1]}
  local opts="${cmds.join(" ")}"
  if [[ $prev == "weave" ]]; then
    COMPREPLY=( $(compgen -W "types docs" -- $cur) )
  elif [[ $prev == "ananse" ]]; then
    COMPREPLY=( $(compgen -W "$opts" -- $cur) )
  else
    COMPREPLY=( $(compgen -W "$opts" -- $cur) )
  fi
  return 0
}
complete -F _ananse_completions ananse
`;
    console.log(script);
  });

await program.parseAsync(process.argv);
