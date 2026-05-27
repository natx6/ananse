import picocolors from "picocolors";
import { writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Alert {
  timestamp: number;
  type: string;
  message: string;
  level: "info" | "warning" | "critical";
}

export interface AlertConfig {
  outputDir?: string;
  dedupWindowMs?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const recentAlerts = new Map<string, number>();
let alertLog: Alert[] = [];
let config: AlertConfig = {};

export function configureAlerts(cfg: AlertConfig): void {
  config = cfg;
}

// ---------------------------------------------------------------------------
// emitAlert
// ---------------------------------------------------------------------------

export function emitAlert(type: string, message: string, level: Alert["level"] = "warning"): void {
  const dedupKey = `${type}:${message}`;
  const now = Date.now();
  const windowMs = config.dedupWindowMs ?? 300_000;

  // Dedup: skip if same alert fired within the window
  const last = recentAlerts.get(dedupKey);
  if (last && now - last < windowMs) return;

  recentAlerts.set(dedupKey, now);

  const alert: Alert = { timestamp: now, type, message, level };
  alertLog.push(alert);

  const color =
    level === "critical" ? picocolors.red :
    level === "warning" ? picocolors.yellow :
    picocolors.blue;

  const label = level.toUpperCase();
  const ts = new Date(now).toLocaleTimeString();
  console.log(color(`\n  [${label}][${ts}] ${type}: ${message}`));

  // Write to alert log file
  if (config.outputDir) {
    const logPath = join(config.outputDir, "alerts.log");
    appendFile(logPath, `[${new Date(now).toISOString()}] [${label}] ${type}: ${message}\n`, "utf-8").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// showAlertSummary
// ---------------------------------------------------------------------------

export function showAlertSummary(alerts?: Alert[]): void {
  const list = alerts ?? alertLog;
  if (list.length === 0) {
    console.log(picocolors.green("  No alerts."));
    return;
  }

  console.log(picocolors.cyan(`  Alerts (${list.length}):`));
  for (const a of list) {
    const color =
      a.level === "critical" ? picocolors.red :
      a.level === "warning" ? picocolors.yellow :
      picocolors.blue;
    const ts = new Date(a.timestamp).toLocaleTimeString();
    console.log(`  ${color(a.level.toUpperCase())} ${picocolors.dim(`[${ts}]`)} ${a.type}: ${a.message}`);
  }
}

// ---------------------------------------------------------------------------
// getAlerts — for programmatic access
// ---------------------------------------------------------------------------

export function getAlerts(): Alert[] {
  return [...alertLog];
}

export function clearAlerts(): void {
  alertLog = [];
  recentAlerts.clear();
}
