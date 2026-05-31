/**
 * Ananse Terminal Dashboard
 *
 * A blessed-based TUI for chatting with AI, managing implants,
 * and viewing capabilities in one split-panel view.
 *
 * Controls:
 *   Tab / arrows  — switch focus between panels
 *   /             — focus input box
 *   q / Ctrl+C    — quit dashboard
 *   r             — refresh fleet status
 */

import blessed from "blessed";
import { streamText } from "ai";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createModelFromConfig } from "./agent.js";
import { C2Client, resolveClientConfig } from "./c2/client/api.js";
import type { ReachSummary } from "./c2/types.js";
import type { AnanseConfig } from "./utils.js";

function loadConfig(): AnanseConfig | null {
  try {
    const p = join(homedir(), ".ananse", "config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as AnanseConfig;
  } catch { /* ignore */ }
  return null;
}

// ── Tool list helper ─────────────────────────────────────
function getToolsList(mode: string): string {
  const all = {
    core: "read, write, edit, command, search, crawl, patch, blast, subagent, analyze, profile, mission, ssh",
    offense: "recon (processes, network, users, cron, SUID), privesc (sudo, writable, kernel), persist, exploit, brute, C2, Shodan, CVE",
    defense: "FIM snapshot/check, rootkit, processes, compliance (SSH, password, mount, auditd), audit (logs, network, users), SBOM, harden",
  };
  const selected = mode === "OFFENSE" ? all.offense : mode === "DEFENSE" ? all.defense : all.core;
  return `Available in {bold}${mode}{/bold}:\n\n${selected}\n\nSwitch modes to see different tools.\nUse 'fleet' for C2 implants.`;
}

// ── Dashboard state ──────────────────────────────────────
let currentMode = "NORMAL";
let fleetData: ReachSummary | null = null;
let chatLog: Array<{ role: string; text: string }> = [];

// ── Build the TUI ────────────────────────────────────────
export function createDashboard() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Ananse — Terminal Dashboard",
    cursor: { artificial: true, blink: true } as any,
  });

  // ── Header bar ───────────────────────────────────────
  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%" as any,
    height: 3,
    content: "",
    tags: true,
    style: { fg: "" as any, bg: "" as any },
    border: { type: "line", fg: "" as any },
  });

  // ── Chat panel (left, large) ─────────────────────────
  const chatBox = blessed.box({
    top: 3,
    left: 0,
    width: "70%" as any,
    height: "100%-6" as any,
    label: " Chat ",
    tags: true,
    border: { type: "line", fg: "" as any },
    style: { fg: "" as any, bg: "" as any },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "" as any } },
    mouse: true,
    keys: true,
    vi: true,
  });

  // ── Fleet panel (right, narrow) ──────────────────────
  const fleetBox = blessed.box({
    top: 3,
    right: 0,
    width: "30%" as any,
    height: "50%-3" as any,
    label: " Implants ",
    tags: true,
    border: { type: "line", fg: "" as any },
    style: { fg: "" as any, bg: "" as any },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "" as any } },
    content: "No C2 server configured.\n\nSet C2_SERVER_URL and C2_API_KEY.",
  });

  // ── Tools panel (right, bottom) ──────────────────────
  const toolsBox = blessed.box({
    bottom: 3,
    right: 0,
    width: "30%" as any,
    height: "50%-3" as any,
    label: " Tools by Mode ",
    tags: true,
    border: { type: "line", fg: "" as any },
    style: { fg: "" as any, bg: "" as any },
    scrollable: true,
    alwaysScroll: true,
    content: getToolsList("DEFENSE"),
  });

  // ── Input box (bottom) ───────────────────────────────
  const input = blessed.textbox({
    bottom: 0,
    left: 0,
    width: "100%" as any,
    height: 3,
    label: " Input ",
    tags: true,
    border: { type: "line", fg: "" as any },
    style: { fg: "" as any, bg: "" as any },
    inputOnFocus: true,
  });

  // ── Append all to screen ─────────────────────────────
  screen.append(header);
  screen.append(chatBox);
  screen.append(fleetBox);
  screen.append(toolsBox);
  screen.append(input);

  // ── Update functions ─────────────────────────────────
  function updateHeader() {
    const modeTag = currentMode === "OFFENSE" ? "{red-fg}" : currentMode === "DEFENSE" ? "{blue-fg}" : "{white-fg}";
    header.setContent(
      ` {bold}Ananse{/} — ${modeTag}${currentMode}{/}  |  ` +
      `Provider: {cyan-fg}OpenRouter{/}  |  ` +
      `Fleet: ${fleetData ? `${fleetData.active} active / ${fleetData.dead} dead` : "N/A"}`
    );
    screen.render();
  }

  function addChat(role: string, text: string) {
    chatLog.push({ role, text });
    const prefix = role === "user" ? "{green-fg}You:{/green-fg} " : "{cyan-fg}Ananse:{/cyan-fg} ";
    chatBox.setContent(
      chatLog.map((m) => {
        const p = m.role === "user" ? "{green-fg}You:{/green-fg}" : "{cyan-fg}Ananse:{/cyan-fg}";
        return `${p} ${m.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
      }).join("\n\n")
    );
    chatBox.setScrollPerc(100);
    screen.render();
  }

  async function refreshFleet() {
    try {
      const cfg = resolveClientConfig(process.env.C2_SERVER_URL, process.env.C2_API_KEY);
      const client = new C2Client(cfg);
      fleetData = await client.reach();
      const lines = fleetData.implants.length === 0
        ? ["(no implants registered)"]
        : fleetData.implants.map((i: any) => {
            const color = i.status === "active" ? "{green-fg}" : i.status === "dead" ? "{red-fg}" : "{white-fg}";
            const seen = new Date(i.lastSeen).toLocaleTimeString();
            return `${color}${i.id.slice(0, 8)}{/} ${i.status} last: ${seen}`;
          });
      fleetBox.setContent(lines.join("\n"));
      updateHeader();
    } catch {
      fleetBox.setContent("Cannot reach C2 server.\nCheck C2_SERVER_URL and C2_API_KEY.");
      screen.render();
    }
  }

  // ── Input handling ───────────────────────────────────
  input.on("submit", async (text: string) => {
    const msg = text.trim();
    if (!msg) return;
    input.clearValue();
    input.focus();

    // Quick mode switch
    const m = msg.toLowerCase().trim();
    if (m === "offense" || m === "defense" || m === "normal") {
      currentMode = m.toUpperCase();
      toolsBox.setContent(getToolsList(currentMode));
      updateHeader();
      addChat("assistant", `Switched to ${currentMode} mode.`);
      screen.render();
      return;
    }

    if (m === "fleet" || m === "implants") {
      await refreshFleet();
      screen.render();
      return;
    }

    addChat("user", msg);
    screen.render();

    // Call AI model
    const config = loadConfig();
    if (!config?.apiKey) {
      addChat("assistant", "No API key configured. Run `ananse configure` first.");
      screen.render();
      return;
    }

    const model = createModelFromConfig(config, currentMode.toLowerCase() as any);
    if (!model) {
      addChat("assistant", `No model available for provider: ${config.provider}`);
      screen.render();
      return;
    }

    try {
      const systemPrompt = `You are Ananse (Advanced Neural Agent for Network Security Exploitation), operating in ${currentMode} mode. Be direct and concise. Answer the user's question.`;

      const result = streamText({
        model,
        system: systemPrompt,
        messages: [
          ...chatLog.filter((l) => l.role !== "system").slice(-10).map((l) => ({
            role: l.role as "user" | "assistant",
            content: l.text,
          })),
          { role: "user" as const, content: msg },
        ],
        maxRetries: 1,
      });

      let response = "";
      for await (const event of result.fullStream) {
        if (event.type === "text-delta") {
          response += event.text;
        }
      }

      if (response.trim()) {
        addChat("assistant", response.trim());
      } else {
        addChat("assistant", "(no response)");
      }
    } catch (err) {
      addChat("assistant", `Error: ${(err as Error).message}`);
    }
    screen.render();
  });

  // ── Keybindings ──────────────────────────────────────
  screen.key(["escape", "q", "C-c"], () => process.exit(0));
  screen.key("/", () => input.focus());
  screen.key(["tab"], () => {
    if (screen.focused === input) chatBox.focus();
    else if (screen.focused === chatBox) fleetBox.focus();
    else if (screen.focused === fleetBox) toolsBox.focus();
    else input.focus();
  });
  screen.key(["r"], () => refreshFleet());

  // ── Init ─────────────────────────────────────────────
  updateHeader();
  refreshFleet();
  addChat("assistant", "Welcome to Ananse Dashboard. Type a message, or 'offense'/'defense' to switch modes. Press / to type, Tab to navigate panels.");
  input.focus();
  screen.render();

  return screen;
}
