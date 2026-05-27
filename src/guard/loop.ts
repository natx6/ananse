import picocolors from "picocolors";
import { streamText } from "ai";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AnanseConfig } from "../utils.js";
import { createModelFromConfig } from "../agent.js";
import { parseTarget, SshSession, targetHost } from "../transport.js";
import { setRemoteExec } from "../execContext.js";
import { takeBaseline, diffBaseline, formatDiff, saveBaseline, loadBaseline } from "./baseline.js";
import type { BaselineSnapshot } from "./baseline.js";
import { emitAlert, configureAlerts, showAlertSummary } from "./alert.js";
import { runProfiler } from "../profiler.js";
import { setStealthConfig } from "../stealth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardOptions {
  interval?: number;   // seconds between checks (default 300)
  output?: string;     // output directory (default ./.ananse/guard/)
  notify?: boolean;    // write alerts to file
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banner(label: string, target: string): string {
  const ts = new Date().toLocaleTimeString();
  return `${picocolors.dim(`[${ts}]`)} ${picocolors.cyan("GUARD")} ${picocolors.white(target)} ${picocolors.dim("·")} ${label}`;
}

// ---------------------------------------------------------------------------
// runGuard
// ---------------------------------------------------------------------------

export async function runGuard(
  target: string,
  config: AnanseConfig,
  opts: GuardOptions = {},
): Promise<void> {
  if (!config.apiKey) {
    console.error(picocolors.red("Error: No API key found."));
    return;
  }

  const intervalMs = (opts.interval ?? 300) * 1000;
  const outputDir = opts.output ?? ".ananse/guard";
  const baselinePath = join(outputDir, "baseline.json");

  // Parse SSH target
  const sshTarget = parseTarget(target);
  const targetLabel = targetHost(sshTarget);

  // Configure alerting
  configureAlerts({
    outputDir: opts.notify ? outputDir : undefined,
    dedupWindowMs: intervalMs * 2,
  });

  // Connect
  console.log(picocolors.cyan(`  Guard connecting to ${targetLabel}...`));

  const sshSession = new SshSession(sshTarget);
  try {
    await sshSession.connect();
  } catch (err) {
    console.error(picocolors.red(`\n  SSH connection failed: ${(err as Error).message}`));
    return;
  }

  setRemoteExec((cmd, timeout) => sshSession.exec(cmd, timeout));
  sshSession.keepalive(60_000);

  console.log(picocolors.green(`  Connected.\n`));

  // Create output directory
  try { await mkdir(outputDir, { recursive: true }); } catch { /* ok */ }

  // Load or take baseline
  let baseline: BaselineSnapshot | null = await loadBaseline(baselinePath);
  if (baseline) {
    console.log(picocolors.dim(`  Loaded baseline from ${baselinePath} (${new Date(baseline.timestamp).toLocaleString()})`));
  } else {
    console.log(picocolors.dim("  Taking initial baseline..."));
    await runProfiler(sshSession);
    baseline = await takeBaseline(sshSession);
    await saveBaseline(baselinePath, baseline);
    console.log(picocolors.green(`  Baseline saved (${baseline.processes.length} processes, ${baseline.listeningPorts.length} ports).\n`));
  }

  console.log(banner(picocolors.green(`watching — interval ${opts.interval ?? 300}s`), targetLabel) + "\n");

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------
  let cycle = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await delay(intervalMs);
      cycle++;

      // Check connection health
      if (!(await sshSession.isConnected())) {
        emitAlert("connection", "SSH connection lost, reconnecting...", "warning");
        const ok = await sshSession.reconnect(3);
        if (!ok) {
          emitAlert("connection", "Failed to reconnect — giving up", "critical");
          break;
        }
        setRemoteExec((cmd, timeout) => sshSession.exec(cmd, timeout));
        sshSession.keepalive(60_000);
        emitAlert("connection", "Reconnected successfully", "info");
        // Re-baseline after reconnect
        baseline = await takeBaseline(sshSession);
        await saveBaseline(baselinePath, baseline);
        continue;
      }

      // Quick re-profile
      const profileResult = await runProfiler(sshSession).catch(() => null);
      if (profileResult?.adaptedConfig) {
        setStealthConfig(profileResult.adaptedConfig);
        sshSession.updateStealthConfig(profileResult.adaptedConfig);
      }

      // Take state snapshot and diff
      const snapshot = await takeBaseline(sshSession);
      const diff = diffBaseline(baseline, snapshot);

      if (diff.summary === "no changes") {
        console.log(banner(picocolors.dim(`cycle ${cycle} — no changes`), targetLabel));
      } else {
        console.log(banner(picocolors.yellow(`cycle ${cycle} — ${diff.summary}`), targetLabel));

        // Alert each category
        for (const p of diff.newProcesses.slice(0, 5)) {
          emitAlert("process", p.split(/\s+/).slice(10).join(" ") || p, "warning");
        }
        for (const p of diff.newPorts) {
          emitAlert("port", p, "warning");
        }
        for (const [path, reason] of Object.entries(diff.modifiedFim)) {
          emitAlert("fim", `${path}: ${reason}`, "critical");
        }
        for (const c of diff.newCronJobs) {
          emitAlert("cron", c, "warning");
        }

        // LLM drift analysis
        try {
          const model = createModelFromConfig(config);
          if (model) {
            const diffText = formatDiff(diff);
            const result = streamText({
              model,
              prompt: [
                `[GUARD ALERT — ${targetLabel}]`,
                "Changes detected since last check:",
                "",
                diffText,
                "",
                "Assess: is this expected system activity or a sign of compromise?",
                "If suspicious, provide a one-line recommended action.",
              ].join("\n"),
            });
            const analysis = await result.text;
            emitAlert("analysis", analysis.trim(), "info");
          }
        } catch {
          emitAlert("analysis", "LLM analysis failed (model unavailable)", "info");
        }

        // Update baseline
        baseline = snapshot;
        await saveBaseline(baselinePath, baseline);
      }
    }
  } finally {
    await sshSession.close().catch(() => {});
    setRemoteExec(null);
    console.log("\n");
    showAlertSummary();
  }
}
