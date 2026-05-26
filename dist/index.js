#!/usr/bin/env node
import picocolors from "picocolors";
import { Command } from "commander";
import { spinner, text, select, isCancel } from "@clack/prompts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { LOGO } from "./branding.js";
import { checkConfig, scanDirectory } from "./utils.js";
import { loadPersonality } from "./personality.js";
import { runAgentLoop } from "./agent.js";
import { runBuildLoop } from "./builder.js";
import { weaveTypes, weaveDocs } from "./weave.js";
import { crawlDirectory, formatGraph } from "./cobweb.js";
import { listSessions, listNamedSessions, loadSessionByName, createSession, saveSession, } from "./session.js";
const CONFIG_DIR = `${homedir()}/.ananse`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
async function readConfigFile() {
    try {
        if (existsSync(CONFIG_PATH)) {
            return JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
        }
    }
    catch { /* ignore */ }
    return {};
}
async function writeConfigFile(config) {
    if (!existsSync(CONFIG_DIR)) {
        await mkdir(CONFIG_DIR, { recursive: true });
    }
    const clean = {};
    for (const [k, v] of Object.entries(config)) {
        if (v !== undefined)
            clean[k] = v;
    }
    await writeFile(CONFIG_PATH, JSON.stringify(clean, null, 2), "utf-8");
}
async function resolveUserName(config) {
    if (config.userName)
        return config.userName;
    // try git
    try {
        const name = execSync("git config user.name", { encoding: "utf-8" }).trim();
        if (name) {
            config.userName = name;
            await writeConfigFile(config);
            return name;
        }
    }
    catch { /* not in a git repo or no name set */ }
    // ask
    const name = await text({
        message: "What's your name?",
        placeholder: "e.g., Alex",
        validate: (v) => (v && v.trim() ? undefined : "Name is required"),
    });
    if (isCancel(name))
        process.exit(0);
    config.userName = name.trim();
    await writeConfigFile(config);
    return config.userName;
}
async function barePrompt() {
    const rl = readline.createInterface({ input: processStdin, output: processStdout });
    try {
        const answer = await rl.question(picocolors.green("> "));
        return answer;
    }
    finally {
        rl.close();
    }
}
async function main() {
    console.clear();
    console.log(picocolors.white(LOGO));
    const s = spinner();
    s.start("Weaving local context...");
    s.message("Weaving local context... checking config");
    const config = await checkConfig();
    s.message("Weaving local context... reading project personality");
    const personality = await loadPersonality();
    s.message("Weaving local context... scanning project files");
    const fileCount = await scanDirectory();
    s.stop(picocolors.green("Context woven successfully"));
    console.log("");
    const summaryParts = [];
    summaryParts.push(`provider: ${config?.provider ?? picocolors.dim("not set")}`);
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
        let response;
        if (firstTurn) {
            response = await text({
                message: "How can I help?",
                placeholder: "Build something, refactor, debug, explore...",
            });
            firstTurn = false;
        }
        else {
            response = await barePrompt();
        }
        if (isCancel(response) || response === undefined) {
            console.log(picocolors.yellow("\nGoodbye."));
            process.exit(0);
        }
        if (typeof response !== "string" || !response.trim())
            continue;
        console.log(picocolors.green(`You: ${response.trim()}`));
        const updatedSession = await runAgentLoop(response.trim(), config ?? {}, personality, fileCount, userName, currentSession);
        if (updatedSession)
            currentSession = updatedSession;
        console.log("");
    }
}
async function configure() {
    const configDir = `${homedir()}/.ananse`;
    const configPath = `${configDir}/config.json`;
    if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
    }
    let existing = {};
    try {
        if (existsSync(configPath)) {
            existing = JSON.parse(await readFile(configPath, "utf-8"));
        }
    }
    catch { /* ignore */ }
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
        initialValue: existing.provider ?? "anthropic",
    });
    if (isCancel(provider))
        process.exit(0);
    const apiKey = await text({
        message: "Enter your API key:",
        placeholder: "sk-...",
        initialValue: existing.apiKey ?? "",
        validate: (v) => (v ? undefined : "API key is required"),
    });
    if (isCancel(apiKey))
        process.exit(0);
    const model = await text({
        message: "Model (optional — press Enter for default):",
        placeholder: provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "openai" ? "gpt-4o" : provider === "google" ? "gemini-2.0-flash" : provider === "xai" ? "grok-2-1212" : provider === "deepseek" ? "deepseek-chat" : "mistral-large-latest",
        initialValue: existing.model ?? "",
    });
    if (isCancel(model))
        process.exit(0);
    const baseURL = await text({
        message: "Base URL (optional — press Enter to skip):",
        placeholder: "https://api.openai.com/v1",
        initialValue: existing.baseURL ?? "",
    });
    if (isCancel(baseURL))
        process.exit(0);
    const config = {
        provider,
        apiKey,
        model: model || undefined,
        baseURL: baseURL || undefined,
    };
    // remove undefined keys
    for (const k of Object.keys(config)) {
        if (config[k] === undefined)
            delete config[k];
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log(picocolors.green(`\nConfig saved to ~/.ananse/config.json`));
}
async function initPersonality() {
    const path = `${process.cwd()}/.ananse.md`;
    if (existsSync(path)) {
        console.log(picocolors.yellow(".ananse.md already exists in this directory."));
        return;
    }
    const template = `# Project Personality

This file tells Ananse about your project's conventions, stack, and preferences.

## Stack

- Language: (e.g., TypeScript, Python, Rust)
- Framework: (e.g., React, Next.js, Django)
- Testing: (e.g., Vitest, pytest)
- Package manager: (e.g., npm, pip, cargo)

## Conventions

- (e.g., use functional components, prefer async/await, naming conventions)

## Preferences

- (e.g., prefer simple solutions over abstractions, focused PRs)
`;
    await writeFile(path, template, "utf-8");
    console.log(picocolors.green("Created .ananse.md"));
    console.log(picocolors.dim("  Edit it to describe your project's conventions."));
}
async function sessionsCommand() {
    const sessions = await listSessions();
    if (sessions.length === 0) {
        console.log(picocolors.yellow("No sessions found."));
        return;
    }
    const options = sessions.map((s) => {
        const date = new Date(s.updatedAt).toLocaleString();
        const msgs = s.messages.length;
        const preview = s.messages.find((m) => m.role === "user")?.content.slice(0, 60) ?? "";
        return {
            value: s.id,
            label: `${picocolors.cyan(date)}  ${picocolors.dim(`${msgs} msgs`)}  ${picocolors.dim(preview)}`,
        };
    });
    const picked = await select({
        message: "Select a session:",
        options,
    });
    if (isCancel(picked))
        return;
    const session = sessions.find((s) => s.id === picked);
    if (!session)
        return;
    console.log(picocolors.cyan(`\n  Session: ${session.id}`));
    for (const msg of session.messages) {
        const role = msg.role === "user" ? picocolors.green("you") : picocolors.blue("anse");
        const content = msg.content.slice(0, 200);
        console.log(`  ${role}: ${picocolors.dim(content)}`);
    }
    console.log("");
}
const program = new Command()
    .name("ananse")
    .description("AI agent for coding tasks")
    .version("0.1.0")
    .action(main);
program
    .command("status")
    .description("Check API status, config, and session storage")
    .action(async () => {
    const config = await readConfigFile();
    const sessions = await listSessions();
    console.log(picocolors.cyan("\n  ─── Config ───"));
    console.log(`  Provider:  ${picocolors.white(config.provider ?? picocolors.dim("not set"))}`);
    console.log(`  Model:     ${picocolors.white(config.model ?? picocolors.dim("default"))}`);
    console.log(`  Base URL:  ${picocolors.dim(config.baseURL ?? "(default)")}`);
    console.log(`  API Key:   ${config.apiKey ? picocolors.green(config.apiKey.slice(0, 8) + "…") : picocolors.red("not set")}`);
    if (config.userName)
        console.log(`  User:      ${picocolors.white(config.userName)}`);
    console.log(picocolors.cyan("\n  ─── Storage ───"));
    console.log(`  Sessions:  ${picocolors.white(String(sessions.length))}`);
    const totalMsgs = sessions.reduce((sum, s) => sum + s.messages.length, 0);
    console.log(`  Messages:  ${picocolors.white(String(totalMsgs))}`);
    console.log(picocolors.cyan("\n  ─── Project ───"));
    const fileCount = await scanDirectory();
    console.log(`  Files:     ${picocolors.white(String(fileCount))} in scope`);
    // Quick API connectivity check
    if (config.apiKey && config.provider === "openai" && config.baseURL) {
        console.log(picocolors.cyan("\n  ─── API Check ───"));
        try {
            const res = await fetch(`${config.baseURL}/models`, {
                headers: { Authorization: `Bearer ${config.apiKey}` },
            });
            if (res.ok) {
                const data = await res.json();
                console.log(`  Status:    ${picocolors.green("connected")}`);
                console.log(`  Models:    ${picocolors.white(String(data.data?.length ?? "?"))} available`);
                const remaining = res.headers.get("x-ratelimit-remaining");
                if (remaining)
                    console.log(`  Rate limit: ${picocolors.yellow(remaining)} requests remaining`);
            }
            else {
                console.log(`  Status:    ${picocolors.red(`HTTP ${res.status}`)}`);
            }
        }
        catch {
            console.log(`  Status:    ${picocolors.red("unreachable")}`);
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
    .action(async (path) => {
    console.log(picocolors.cyan(`\n  Crawling ${picocolors.dim(path)} for dependencies...\n`));
    const graph = await crawlDirectory(path);
    console.log(formatGraph(graph));
});
program
    .command("build")
    .description("Run a build command with automatic error fixing")
    .argument("<command>", "Build command to execute")
    .action(async (command) => {
    const config = await readConfigFile();
    await runBuildLoop(command, config);
});
program
    .command("spin")
    .description("Create a new named session")
    .argument("<name>", "Session name")
    .action(async (name) => {
    const config = await readConfigFile();
    const session = createSession(config, null, 0, name);
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
    .action(async (name) => {
    if (name) {
        const session = await loadSessionByName(name);
        if (!session) {
            console.log(picocolors.yellow(`\n  No session found: "${name}"`));
            return;
        }
        console.log(picocolors.cyan(`\n  Restored: ${name} (${session.messages.length} messages)`));
    }
    else {
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
    .command("weave")
    .description("Generate structured output from source files")
    .addCommand(new Command("types")
    .description("Extract type definitions from a file")
    .argument("<path>", "File path")
    .action(async (path) => {
    const config = await readConfigFile();
    await weaveTypes(path, config);
}))
    .addCommand(new Command("docs")
    .description("Generate documentation from a file")
    .argument("<path>", "File path")
    .action(async (path) => {
    const config = await readConfigFile();
    await weaveDocs(path, config);
}));
await program.parseAsync(process.argv);
//# sourceMappingURL=index.js.map