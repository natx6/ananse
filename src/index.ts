#!/usr/bin/env node

import picocolors from "picocolors";
import { Command } from "commander";
import { spinner, text, select, isCancel } from "@clack/prompts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { execSync, execFileSync } from "node:child_process";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { LOGO, TAGLINE } from "./branding.js";
import { checkConfig, scanDirectory } from "./utils.js";
import { loadPersonality } from "./personality.js";
import { dangerousMode, setDangerousMode } from "./permission.js";
import { getModeFromConfig, getToolNamesForMode, printModeInfo } from "./mode.js";
import type { AnanseMode } from "./mode.js";
import { loadPolicy } from "./policy.js";
import { listPlugins } from "./plugin.js";
import { initKnowledge } from "./knowledge.js";
import { runAgentLoop } from "./agent.js";
import { runBuildLoop } from "./builder.js";
import { runRefactor } from "./refactor.js";
import { weaveTypes, weaveDocs } from "./weave.js";
import { crawlDirectory, formatGraph } from "./cobweb.js";
import { sortDirectory } from "./sorter.js";
import { generatePatches, applyPatches } from "./patch.js";
import { runReview } from "./review.js";
import { runTestGen } from "./testgen.js";
import { runExplain } from "./explain.js";
import { runDoctor } from "./doctor.js";
import { configGet, configSet } from "./configcmd.js";
import { runFixLoop } from "./fix.js";
import { runProbe } from "./probe.js";
import { runAttack } from "./attack.js";
import { runDefend } from "./defend.js";
import { runGuard } from "./guard/loop.js";
import { startServer } from "./c2/server/index.js";
import { createC2Command } from "./c2/client/index.js";
import {
  listSessions,
  listNamedSessions,
  searchSessions,
  loadSessionByName,
  loadSession,
  forkSession,
  createSession,
  saveSession,
  renameSession,
  deleteSession,
} from "./session.js";

// Global error handlers
process.on("unhandledRejection", (reason) => {
  console.error(picocolors.red("\n  Unhandled rejection:"), reason);
});
process.on("uncaughtException", (error) => {
  console.error(picocolors.red("\n  Uncaught exception:"), error.message);
  process.exit(1);
});

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

const promptHistory: string[] = [];

async function barePrompt(): Promise<string | symbol> {
  const rl = readline.createInterface({
    input: processStdin,
    output: processStdout,
    history: promptHistory,
    historySize: 100,
  });
  try {
    const answer = await rl.question(picocolors.dim("\n  ── ") + picocolors.green("You » ") + picocolors.reset(""));
    return answer;
  } catch {
    console.log(picocolors.yellow("\nGoodbye."));
    process.exit(0);
  } finally {
    rl.close();
  }
}

function formatMode(mode: string): string {
  switch (mode) {
    case "offense": return picocolors.inverse(picocolors.red(" OFFENSE "));
    case "defense": return picocolors.inverse(picocolors.blue(" DEFENSE "));
    default: return picocolors.dim("normal");
  }
}

/** Color tags for mode-specific commands in help text */
function offenseTag(): string { return picocolors.red("[offense]"); }
function defenseTag(): string { return picocolors.blue("[defense]"); }

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

  s.message("Weaving local context... loading security policy");
  await loadPolicy();

  s.message("Weaving local context... initializing knowledge base");
  await initKnowledge();

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

  // resolve user name (git → ask → persist)
  const flatConfig = await readConfigFile();
  const userName = await resolveUserName(flatConfig);

  const summaryParts: string[] = [];
  const currentMode = getModeFromConfig(flatConfig);
  summaryParts.push(
    `mode: ${formatMode(currentMode)}`,
    `provider: ${config?.provider ?? picocolors.dim("not set")}`,
  );
  summaryParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"} in scope`);
  if (currentMode !== "normal") {
    const tools = getToolNamesForMode(currentMode).join(", ");
    summaryParts.push(picocolors.dim(`tools: ${tools}`));
  }
  console.log(picocolors.dim(`  ${summaryParts.join(" | ")}`));
  console.log("");

  let firstTurn = true;
  let currentSession = createSession(config ?? {}, personality, fileCount);

  // Offer to resume a recent session
  const recentSessions = await listSessions();
  const resumable = recentSessions.filter((s) => s.messages.length > 0);
  if (resumable.length > 0) {
    const choice = await select({
      message: "Resume a recent session?",
      options: [
        { value: "__new__", label: "Start fresh" },
        ...resumable.slice(0, 5).map((s) => ({
          value: s.id,
          label: `${s.name ?? s.messages[0]?.content.slice(0, 40) ?? "unnamed"}  ${picocolors.dim(`${s.messages.length} msgs`)}`,
        })),
      ],
    });
    if (!isCancel(choice) && choice !== "__new__") {
      const loaded = await loadSession(choice as string);
      if (loaded) {
        currentSession = loaded;
        const lines = loaded.name
          ? `Resumed session: ${picocolors.cyan(loaded.name)}`
          : `Resumed session (${loaded.messages.length} messages)`;
        console.log(picocolors.green(`  ${lines}\n`));
      }
    }
  }

  while (true) {
    let response: string | symbol;

    if (firstTurn) {
      response = await text({
        message: "How can I help?",
        placeholder: "scan, deploy, audit, build...",
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
          console.log(`  ${picocolors.dim("/mode")}     Show or change mode (/mode offense|defense|normal)`);
          console.log(`  ${picocolors.dim("/model")}     Change AI model (e.g., /model gpt-4o)`);
          console.log(`  ${picocolors.dim("/clear")}     Clear conversation history`);
          console.log(`  ${picocolors.dim("/save")}     Save session with a name`);
          console.log(`  ${picocolors.dim("/status")}   Show session info (msgs, tokens)`);
          console.log(`  ${picocolors.dim("/danger")}   Toggle dangerous mode`);
          console.log(`  ${picocolors.dim("/exit")}     Exit Ananse`);
          console.log(picocolors.dim("\n  Tip: search sessions with `ananse search <query>`"));
          console.log(picocolors.dim("  Tip: review changes with `ananse review`\n"));
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
        case "mode": {
          const newMode = args[0]?.toLowerCase();
          if (!newMode) {
            const m = getModeFromConfig(flatConfig);
            console.log(picocolors.cyan(`\n  Current mode: ${formatMode(m)}\n`));
          } else if (["normal", "offense", "defense"].includes(newMode)) {
            flatConfig.mode = newMode;
            await writeConfigFile(flatConfig);
            if (config) config.mode = newMode;
            const ms = spinner();
            ms.start(`Loading ${newMode.toUpperCase()} modules...`);
            await new Promise((r) => setTimeout(r, 1200));
            ms.stop("");
            const banner = newMode === "offense" ? [
              `  ${picocolors.red("╔══════════════════════════════════════╗")}`,
              `  ${picocolors.red("║")}            ${picocolors.inverse(picocolors.red(" OFFENSE MODE "))}            ${picocolors.red("║")}`,
              `  ${picocolors.red("║")}    TAO//ECI — Full Spectrum Ops     ${picocolors.red("║")}`,
              `  ${picocolors.red("╚══════════════════════════════════════╝")}`,
            ] : newMode === "defense" ? [
              `  ${picocolors.blue("╔══════════════════════════════════════╗")}`,
              `  ${picocolors.blue("║")}            ${picocolors.inverse(picocolors.blue(" DEFENSE MODE "))}            ${picocolors.blue("║")}`,
              `  ${picocolors.blue("║")}   FORNSAT//SI — SIGINT Defense      ${picocolors.blue("║")}`,
              `  ${picocolors.blue("╚══════════════════════════════════════╝")}`,
            ] : [];
            for (const line of banner) console.log(line);
            printModeInfo(newMode as "normal" | "offense" | "defense");
            currentSession = createSession(config ?? {}, personality, fileCount);
          } else {
            console.log(picocolors.yellow(`\n  Unknown mode: ${newMode}. Use normal, offense, or defense.\n`));
          }
          break;
        }
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
          const modeLabel = getModeFromConfig(flatConfig);
          console.log(picocolors.cyan(`\n  Session: ${currentSession.name ?? picocolors.dim("unnamed")}`));
          console.log(`  Mode:    ${formatMode(modeLabel)}`);
          console.log(`  Model:   ${config?.model ?? picocolors.dim("default")}`);
          console.log(`  Provider: ${config?.provider ?? picocolors.dim("not set")}`);
          console.log(`  Messages: ${picocolors.white(String(msgs))} total`);
          for (const [role, count] of Object.entries(roleCounts)) {
            console.log(`    ${role}: ${count}`);
          }
          if (currentSession.tokenUsage) {
            const tu = currentSession.tokenUsage;
            console.log(`  Tokens:  ${picocolors.white(String(tu.totalTokens))} total (${picocolors.dim(`${tu.promptTokens} in / ${tu.completionTokens} out`)} )`);
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
          break;
        default:
          console.log(picocolors.yellow(`\n  Unknown command: /${cmd}. Try /help\n`));
      }
      continue;
    }

    // Natural-language mode switch detection
    const modeSingle = input.match(/^\s*(normal|offense|defence|defense)\s*$/i);
    const modePhrase = input.match(/^\s*(?:switch|change|go|set)\s+to\s+(normal|offense|defence|defense)\s*$/i);
    const modeMatch = modeSingle ?? modePhrase;
    if (modeMatch) {
      let targetMode = modeMatch[1].toLowerCase();
      if (targetMode === "defence") targetMode = "defense";
      flatConfig.mode = targetMode;
      await writeConfigFile(flatConfig);
      if (config) config.mode = targetMode;

      const s = spinner();
      s.start(`Loading ${targetMode.toUpperCase()} modules...`);
      await new Promise((r) => setTimeout(r, 1200));
      s.stop("");

      const banner = targetMode === "offense" ? [
        `  ${picocolors.red("╔══════════════════════════════════════╗")}`,
        `  ${picocolors.red("║")}            ${picocolors.inverse(picocolors.red(" OFFENSE MODE "))}            ${picocolors.red("║")}`,
        `  ${picocolors.red("║")}    TAO//ECI — Full Spectrum Ops     ${picocolors.red("║")}`,
        `  ${picocolors.red("╚══════════════════════════════════════╝")}`,
      ] : targetMode === "defense" ? [
        `  ${picocolors.blue("╔══════════════════════════════════════╗")}`,
        `  ${picocolors.blue("║")}            ${picocolors.inverse(picocolors.blue(" DEFENSE MODE "))}            ${picocolors.blue("║")}`,
        `  ${picocolors.blue("║")}   FORNSAT//SI — SIGINT Defense      ${picocolors.blue("║")}`,
        `  ${picocolors.blue("╚══════════════════════════════════════╝")}`,
      ] : [];
      for (const line of banner) console.log(line);

      printModeInfo(targetMode as "normal" | "offense" | "defense");
      currentSession = createSession(config ?? {}, personality, fileCount);
      continue;
    }

    console.log(picocolors.dim("\n  ──┤ ") + picocolors.green(input) + picocolors.dim(" ├──"));
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
  .description("Advanced Neural Agent for Network Security exploitation")
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
  .command("capabilities")
  .description("List all Ananse platform capabilities")
  .action(() => {
    console.log(picocolors.cyan("\n  Ananse — Platform Capabilities\n"));
    console.log(picocolors.bold("  Modes:"));
    console.log("    normal    General-purpose AI coding assistant");
    console.log("    offense   Red-team auditor with C2 implant control");
    console.log("    defense   Blue-team engineer for hardening & compliance");
    console.log("");
    console.log(picocolors.bold("  C2 Operations:"));
    console.log("    c2 reach     List deployed implants");
    console.log("    c2 task      Create, list, view, cancel tasks");
    console.log("    c2 deploy    Build + deploy stager via SSH");
    console.log("    c2 kill      Self-destruct an implant");
    console.log("    c2 watch     Live-stream implant events");
    console.log("");
    console.log(picocolors.bold("  Offense Modules (27):"));
    console.log("    recon      processes, network, users, scheduler, SUID");
    console.log("    privesc    sudo, writable paths, kernel exploits");
    console.log("    persist    SSH keys, startup, SSH config");
    console.log("    exploit    package CVEs, service scanning");
    console.log("    credential SSH brute-force, secrets discovery, web probing");
    console.log("    shodan     IP lookup, device search, vulnerability queries");
    console.log("    cve        CVE search and detail lookup (free, no key)");
    console.log("");
    console.log(picocolors.bold("  Defense Modules (13):"));
    console.log("    monitor    FIM snapshot/check, rootkit, processes");
    console.log("    compliance SSH, password policy, mounts, auditd");
    console.log("    audit      log analysis, network audit, user audit");
    console.log("    sbom       generate SBOM, CVE checking");
    console.log("");
    console.log(picocolors.bold("  Platform:"));
    console.log("    System:    system info, disk usage, network info");
    console.log("    Implants:  Linux, Windows, macOS");
    console.log("    Transport: HTTP/HTTPS, WSS, SOCKS5 proxy");
    console.log("    Build:     ./scripts/build-stager.sh --os <target>\n");
  });

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
  .command("heal")
  .description("Run a command with automatic error fixing")
  .argument("<command>", "Command to execute and fix")
  .action(async (command: string) => {
    const config = await readConfigFile();
    await runFixLoop(command, config as any);
  });

program
  .command("commit")
  .description("Stage all files and create a git commit")
  .argument("<message>", "Commit message")
  .action(async (message: string) => {
    try {
      execSync("git add -A", { encoding: "utf-8" });
      execFileSync("git", ["commit", "-m", message], { encoding: "utf-8" });
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
        execFileSync("git", ["commit", "-m", title], { encoding: "utf-8" });
      } catch { /* nothing to commit */ }
      const remote = execSync("git config remote.origin.url", { encoding: "utf-8" }).trim();
      if (!remote) { console.log(picocolors.red("\n  No remote configured.")); return; }
      execFileSync("git", ["push", "-u", "origin", branch], { encoding: "utf-8" });
      const url = execFileSync("gh", ["pr", "create", "--title", title, "--body", ""], { encoding: "utf-8" }).trim();
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
  .command("freeze")
  .description("Stash uncommitted changes")
  .argument("<name>", "Freeze name")
  .action(async (name: string) => {
    try {
      const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
      if (!status) {
        console.log(picocolors.yellow("\n  Nothing to stash — working tree is clean."));
        return;
      }
      execFileSync("git", ["stash", "push", "-m", `ananse: ${name}`], { encoding: "utf-8" });
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
        execFileSync("git", ["stash", "push", "-m", `ananse: auto-${ts}`], { encoding: "utf-8" });
        console.log(picocolors.dim(`  Stashed ${status.split("\n").length} file(s) before switching`));
      }
      execFileSync("git", ["checkout", branch], { encoding: "utf-8" });
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
  .command("review")
  .description("AI code review for staged and unstaged changes")
  .action(async () => {
    const config = await readConfigFile();
    await runReview(config as any);
  });

program
  .command("testgen")
  .description("Generate unit tests for a file using AI")
  .argument("<file>", "File to generate tests for")
  .action(async (file: string) => {
    const config = await readConfigFile();
    await runTestGen(file, config as any);
  });

program
  .command("explain")
  .description("Explain code using AI")
  .argument("<file>", "File to explain")
  .argument("[target]", "Specific function or class to explain")
  .action(async (file: string, target?: string) => {
    const config = await readConfigFile();
    await runExplain(file, config as any, target);
  });

program
  .command("search")
  .description("Search session messages")
  .argument("<query>", "Search term")
  .action(async (query: string) => {
    const results = await searchSessions(query);
    if (results.length === 0) {
      console.log(picocolors.yellow(`\n  No sessions match "${query}"\n`));
      return;
    }
    console.log(picocolors.cyan(`\n  Found ${results.length} session(s) matching "${query}":\n`));
    for (const { session, matches } of results) {
      console.log(`  ${picocolors.white(session.name ?? "unnamed")}  ${picocolors.dim(`(${matches.length} match(es))`)}`);
      for (const match of matches.slice(0, 3)) {
        const preview = match.content.slice(0, 120).replace(/\n/g, " ");
        console.log(`    ${picocolors.dim("└")} ${picocolors.dim(preview)}`);
      }
      if (matches.length > 3) {
        console.log(`    ${picocolors.dim("└ and")} ${matches.length - 3} ${picocolors.dim("more matches")}`);
      }
      console.log("");
    }
  });

program
  .command("doctor")
  .description("Check system health (config, git, sessions)")
  .action(async () => {
    await runDoctor();
  });

program
  .command("mode")
  .description("Show current mode")
  .argument("[mode]", "Switch mode: normal, offense, or defense")
  .action(async (mode?: string) => {
    const config = await readConfigFile();
    if (!mode) {
      const m = getModeFromConfig(config);
      console.log(picocolors.cyan(`\n  Current mode: ${formatMode(m)}\n`));
      return;
    }
    const lower = mode.toLowerCase();
    if (!["normal", "offense", "defense"].includes(lower)) {
      console.log(picocolors.yellow(`\n  Unknown mode: ${lower}. Use normal, offense, or defense.\n`));
      return;
    }
    config.mode = lower;
    await writeConfigFile(config);
    console.log(picocolors.green(`\n  Mode set to: ${picocolors.white(lower)}\n`));
    printModeInfo(lower as "normal" | "offense" | "defense");
  });

program
  .command("plugin")
  .description("Manage plugins")
  .addCommand(
    new Command("list")
      .description("List installed plugins")
      .action(async () => {
        const plugins = await listPlugins();
        if (plugins.length === 0) {
          console.log(picocolors.yellow("\n  No plugins installed.\n"));
          return;
        }
        console.log(picocolors.cyan("\n  Installed plugins:\n"));
        for (const p of plugins) {
          const tools = p.tools.map((t) => `${t.name}(${t.mode})`).join(", ");
          console.log(`  ${picocolors.white(p.name)} ${picocolors.dim(`v${p.version}`)}`);
          console.log(`  ${picocolors.dim(p.description)}`);
          console.log(`  ${picocolors.dim(`  Tools: ${tools}`)}\n`);
        }
      }),
  );

program
  .command("probe")
  .description("Scan project for security vulnerabilities")
  .argument("[target]", "Specific file or directory to scan")
  .option("-o, --output <file>", "Write report to file")
  .option("-s, --stealth", "Enable stealth mode (traffic shaping, quiet commands)")
  .action(async (target: string | undefined, opts: { output?: string; stealth?: boolean }) => {
    const config = await readConfigFile();
    await runProbe(target, config as any, { stealth: opts.stealth }, opts.output);
  });

program
  .command("attack")
  .description(`${offenseTag()} Run offense mode against a target (SSH or local path)`)
  .argument("<target>", "Target (user@host or ./path)")
  .option("--recon", "Recon only")
  .option("--all", "Full pentest suite")
  .option("-o, --output <file>", "Write report to file")
  .option("-s, --stealth", "Enable stealth mode (traffic shaping, quiet commands)")
  .action(async (target: string, opts: { recon?: boolean; all?: boolean; output?: string; stealth?: boolean }) => {
    const config = await readConfigFile();
    config.mode = "offense";
    await writeConfigFile(config);
    await runAttack(target, config as any, opts, opts.output);
  });

program
  .command("defend")
  .description(`${defenseTag()} Run defense mode against a target (SSH or local path)`)
  .argument("<target>", "Target (user@host or ./path)")
  .option("--harden", "Full hardening assessment")
  .option("--monitor", "Monitoring only (rootkit, FIM, processes)")
  .option("-o, --output <file>", "Write report to file")
  .option("-s, --stealth", "Enable stealth mode (traffic shaping, quiet commands)")
  .action(async (target: string, opts: { harden?: boolean; monitor?: boolean; output?: string; stealth?: boolean }) => {
    const config = await readConfigFile();
    config.mode = "defense";
    await writeConfigFile(config);
    await runDefend(target, config as any, opts, opts.output);
  });

program
  .command("guard")
  .description(`${defenseTag()} Persistent monitoring — watch a remote target for drift`)
  .argument("<target>", "SSH target (user@host[:port])")
  .option("-i, --interval <seconds>", "Check interval in seconds", "300")
  .option("-o, --output <dir>", "Output directory for baseline and alerts")
  .option("--notify", "Write alerts to log file")
  .action(async (target: string, opts: { interval?: string; output?: string; notify?: boolean }) => {
    const config = await readConfigFile();
    await runGuard(target, config as any, {
      interval: opts.interval ? parseInt(opts.interval, 10) : 300,
      output: opts.output,
      notify: opts.notify,
    });
  });

program
  .command("c2-server")
  .description(`${offenseTag()} Start the C2 command & control server`)
  .option("-p, --port <number>", "Port to listen on", "8443")
  .option("--host <address>", "Host to bind to", "0.0.0.0")
  .option("--db <path>", "SQLite database path")
  .option("--cert <path>", "TLS cert file (enables HTTPS)")
  .option("--key <path>", "TLS key file")
  .action((opts: { port?: string; host?: string; db?: string; cert?: string; key?: string }) => {
    const server = startServer({
      port: opts.port ? parseInt(opts.port, 10) : 8443,
      host: opts.host,
      dbPath: opts.db,
      cert: opts.cert,
      key: opts.key,
    });

    // Handle shutdown
    process.on("SIGINT", () => {
      console.log("\n  Shutting down C2 server...");
      server.close();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      server.close();
      process.exit(0);
    });
  });

program.addCommand(createC2Command());

program
  .command("fork")
  .description("Fork an existing session under a new name")
  .argument("<session>", "Session name or ID to fork")
  .argument("<new-name>", "Name for the new session")
  .action(async (session: string, newName: string) => {
    const fork = await forkSession(session, newName);
    if (fork) {
      console.log(picocolors.green(`\n  Forked: ${picocolors.white(session)} → ${picocolors.white(newName)} (${fork.id})\n`));
    } else {
      console.log(picocolors.yellow(`\n  Session not found: "${session}"\n`));
    }
  });

program
  .command("config")
  .description("View or set configuration")
  .addCommand(
    new Command("get")
      .description("Show config values")
      .argument("[key]", "Config key (apiKey, provider, model, baseURL, userName)")
      .action(async (key?: string) => configGet(key)),
  )
  .addCommand(
    new Command("set")
      .description("Set a config value")
      .argument("<key>", "Config key")
      .argument("<value>", "Config value")
      .action(async (key: string, value: string) => configSet(key, value)),
  );

program
  .command("completions")
  .description("Generate shell completion script")
  .argument("[shell]", "Shell type (bash or zsh)", "bash")
  .option("--install", "Install completions to shell config")
  .action(async (shell: string, opts: { install?: boolean }) => {
    const cmds = program.commands.map((c) => c.name()).filter((n) => n !== "completions");
    const script = shell === "zsh" ? `#compdef ananse
_ananse() {
  compadd ${cmds.join(" ")}
}
compdef _ananse ananse
` : `_ananse_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local opts="${cmds.join(" ")}"
  COMPREPLY=( $(compgen -W "$opts" -- $cur) )
  return 0
}
complete -F _ananse_completions ananse
`;
    if (opts.install) {
      const rcFile = shell === "zsh"
        ? join(homedir(), ".zshrc")
        : join(homedir(), ".bashrc");
      try {
        const existing = await readFile(rcFile, "utf-8").catch(() => "");
        if (existing.includes("_ananse_completions") || existing.includes("_ananse")) {
          console.log(picocolors.yellow(`\n  Completions already installed in ${rcFile}\n`));
          return;
        }
        await writeFile(rcFile, `${existing}\n# ananse completions\n${script}\n`, "utf-8");
        console.log(picocolors.green(`\n  Completions installed for ${shell}. Restart your shell or run:\n    source ${rcFile}\n`));
      } catch {
        console.error(picocolors.red(`\n  Failed to write to ${rcFile}\n`));
      }
    } else {
      console.log(script);
    }
  });

program
  .command("diff")
  .description("Compare two sessions")
  .argument("<session1>", "First session name or ID")
  .argument("<session2>", "Second session name or ID")
  .action(async (s1: string, s2: string) => {
    const sessions = await listSessions();
    const find = (nameOrId: string) =>
      sessions.find((s) => s.name === nameOrId || s.id === nameOrId || s.id.startsWith(nameOrId));
    const a = find(s1);
    const b = find(s2);
    if (!a || !b) {
      console.log(picocolors.yellow(`\n  Session not found: "${!a ? s1 : s2}"\n`));
      return;
    }
    console.log(picocolors.cyan(`\n  Comparing: ${picocolors.white(a.name ?? a.id)} vs ${picocolors.white(b.name ?? b.id)}\n`));
    console.log(`  ${picocolors.dim("─── Session 1 ───")}`);
    console.log(`  Name:     ${a.name ?? picocolors.dim("unnamed")}`);
    console.log(`  Created:  ${new Date(a.createdAt).toLocaleString()}`);
    console.log(`  Updated:  ${new Date(a.updatedAt).toLocaleString()}`);
    console.log(`  Messages: ${a.messages.length}`);
    if (a.tokenUsage) console.log(`  Tokens:   ${a.tokenUsage.totalTokens}`);
    console.log(`  ${picocolors.dim("─── Session 2 ───")}`);
    console.log(`  Name:     ${b.name ?? picocolors.dim("unnamed")}`);
    console.log(`  Created:  ${new Date(b.createdAt).toLocaleString()}`);
    console.log(`  Updated:  ${new Date(b.updatedAt).toLocaleString()}`);
    console.log(`  Messages: ${b.messages.length}`);
    if (b.tokenUsage) console.log(`  Tokens:   ${b.tokenUsage.totalTokens}`);

    const diff = a.messages.length - b.messages.length;
    const shared = Math.min(
      a.messages.filter((m) => b.messages.some((n) => n.content === m.content)).length,
      b.messages.filter((n) => a.messages.some((m) => m.content === n.content)).length,
    );
    console.log(`  ${picocolors.dim("─── Comparison ───")}`);
    console.log(`  Shared:   ${shared} message${shared === 1 ? "" : "s"}`);
    console.log(`  Diff:     ${diff > 0 ? `${picocolors.green(`+${diff}`)} (s1 has more)` : diff < 0 ? `${picocolors.red(`${diff}`)} (s2 has more)` : picocolors.dim("identical")}`);
    if (a.tokenUsage && b.tokenUsage) {
      const tDiff = a.tokenUsage.totalTokens - b.tokenUsage.totalTokens;
      console.log(`  Tokens:   ${tDiff > 0 ? picocolors.green(`+${tDiff}`) : tDiff < 0 ? picocolors.red(`${tDiff}`) : picocolors.dim("identical")}`);
    }
    console.log("");
  });

program
  .command("license")
  .description("Show or set license key")
  .argument("[action]", "Action: status (default), set <key>")
  .argument("[value]", "License key value (for 'set')")
  .action(async (action?: string, value?: string) => {
    if (action === "set" && value) {
      const { setLicenseKey, printLicenseStatus } = await import("./license.js");
      const ok = setLicenseKey(value);
      if (ok) {
        console.log(picocolors.green(`\n  License key saved.\n`));
        printLicenseStatus();
      } else {
        console.error(picocolors.red(`\n  Failed to save license key.\n`));
      }
    } else {
      const { printLicenseStatus } = await import("./license.js");
      printLicenseStatus();
    }
  });

program.addHelpText("after", `
${picocolors.cyan("  Categories:")}
${picocolors.dim("    Core:")}     configure, init, status, doctor, config, mode
${picocolors.dim("    Sessions:")} sessions, spin, pop, stash, rename, rm, fork, diff, search
${picocolors.dim("    AI:")}       build, refactor, review, testgen, explain, patch, weave, heal
${picocolors.red("    Offense:")}  attack, c2-server, c2
${picocolors.green("    Defense:")}  defend, guard
${picocolors.dim("    Git:")}      commit, pr, freeze, switch
${picocolors.dim("    Project:")}  sort, web
${picocolors.dim("    Other:")}    completions
`);

await program.parseAsync(process.argv);
