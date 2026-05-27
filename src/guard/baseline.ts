import type { SshSession } from "../transport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaselineSnapshot {
  timestamp: number;
  processes: string[];
  network: string[];
  cronJobs: string[];
  suidBinaries: string[];
  listeningPorts: string[];
  fimHashes: Record<string, string>;
  userAccounts: string[];
}

export interface BaselineDiff {
  newProcesses: string[];
  goneProcesses: string[];
  newPorts: string[];
  gonePorts: string[];
  newCronJobs: string[];
  modifiedFim: Record<string, string>;
  newUsers: string[];
  goneUsers: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

async function exec(ssh: SshSession, cmd: string): Promise<string> {
  try {
    const r = await ssh.exec(cmd, 15_000);
    return [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
  } catch {
    return "";
  }
}

async function execAll(ssh: SshSession, cmds: string[]): Promise<string[]> {
  return Promise.all(cmds.map((c) => exec(ssh, c)));
}

// ---------------------------------------------------------------------------
// takeBaseline — run all probes in parallel
// ---------------------------------------------------------------------------

export async function takeBaseline(ssh: SshSession): Promise<BaselineSnapshot> {
  const [ps, ss, crontab, suid, fim, users] = await execAll(ssh, [
    "ps aux 2>/dev/null | head -100 || echo ''",
    "ss -tuln 2>/dev/null | head -50 || echo ''",
    "crontab -l 2>/dev/null || cat /etc/crontab 2>/dev/null || echo '(no crontab)'",
    "find / -perm -4000 -type f 2>/dev/null | head -100 || echo ''",
    "sha256sum /etc/passwd /etc/shadow /etc/ssh/sshd_config /etc/sudoers 2>/dev/null || echo '(fim limited)'",
    "cat /etc/passwd 2>/dev/null | grep -E '/home|/root' | head -50 || echo ''",
  ]);

  const fimHashes: Record<string, string> = {};
  for (const line of fim.split("\n")) {
    const m = line.match(/^([a-f0-9]+)\s+(.+)/);
    if (m) fimHashes[m[2]] = m[1];
  }

  const portLines = ss
    .split("\n")
    .filter((l) => l.includes("LISTEN"))
    .map((l) => l.trim());

  return {
    timestamp: Date.now(),
    processes: ps.split("\n").filter(Boolean),
    network: ss.split("\n").filter(Boolean),
    cronJobs: crontab.split("\n").filter(Boolean),
    suidBinaries: suid.split("\n").filter(Boolean),
    listeningPorts: portLines,
    fimHashes,
    userAccounts: users.split("\n").filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// diffBaseline — compare two snapshots
// ---------------------------------------------------------------------------

export function diffBaseline(before: BaselineSnapshot, after: BaselineSnapshot): BaselineDiff {
  const beforePs = new Set(before.processes);
  const afterPs = new Set(after.processes);

  const newProcesses = after.processes.filter((p) => !beforePs.has(p));
  const goneProcesses = before.processes.filter((p) => !afterPs.has(p));

  const beforePorts = new Set(before.listeningPorts);
  const afterPorts = new Set(after.listeningPorts);

  const newPorts = after.listeningPorts.filter((p) => !beforePorts.has(p));
  const gonePorts = before.listeningPorts.filter((p) => !afterPorts.has(p));

  const beforeCron = new Set(before.cronJobs);
  const newCronJobs = after.cronJobs.filter((c) => !beforeCron.has(c));

  const modifiedFim: Record<string, string> = {};
  for (const [path, hash] of Object.entries(after.fimHashes)) {
    if (before.fimHashes[path] && before.fimHashes[path] !== hash) {
      modifiedFim[path] = `hash changed: ${before.fimHashes[path].slice(0, 12)} → ${hash.slice(0, 12)}`;
    }
  }
  for (const path of Object.keys(before.fimHashes)) {
    if (!after.fimHashes[path]) {
      modifiedFim[path] = "file missing";
    }
  }

  const beforeUsers = new Set(before.userAccounts);
  const afterUsers = new Set(after.userAccounts);
  const newUsers = after.userAccounts.filter((u) => !beforeUsers.has(u));
  const goneUsers = before.userAccounts.filter((u) => !afterUsers.has(u));

  const parts: string[] = [];
  if (newProcesses.length) parts.push(`${newProcesses.length} new process(es)`);
  if (goneProcesses.length) parts.push(`${goneProcesses.length} stopped process(es)`);
  if (newPorts.length) parts.push(`${newPorts.length} new port(s)`);
  if (newCronJobs.length) parts.push(`${newCronJobs.length} new cron job(s)`);
  if (Object.keys(modifiedFim).length) parts.push(`${Object.keys(modifiedFim).length} file change(s)`);
  if (newUsers.length) parts.push(`${newUsers.length} new user(s)`);

  return {
    newProcesses,
    goneProcesses,
    newPorts,
    gonePorts,
    newCronJobs,
    modifiedFim,
    newUsers,
    goneUsers,
    summary: parts.length ? parts.join(", ") : "no changes",
  };
}

// ---------------------------------------------------------------------------
// formatDiff — human-readable diff
// ---------------------------------------------------------------------------

export function formatDiff(diff: BaselineDiff): string {
  const lines: string[] = [];

  if (diff.newProcesses.length) {
    lines.push("New processes:", ...diff.newProcesses.slice(0, 10).map((p) => `  + ${p}`));
  }
  if (diff.goneProcesses.length) {
    lines.push("Stopped processes:", ...diff.goneProcesses.slice(0, 10).map((p) => `  - ${p}`));
  }
  if (diff.newPorts.length) {
    lines.push("New listening ports:", ...diff.newPorts.map((p) => `  + ${p}`));
  }
  if (diff.gonePorts.length) {
    lines.push("Closed ports:", ...diff.gonePorts.map((p) => `  - ${p}`));
  }
  if (diff.newCronJobs.length) {
    lines.push("New cron jobs:", ...diff.newCronJobs.map((c) => `  + ${c}`));
  }
  if (Object.keys(diff.modifiedFim).length) {
    lines.push("File changes:", ...Object.entries(diff.modifiedFim).map(([p, r]) => `  ${p}: ${r}`));
  }
  if (diff.newUsers.length) {
    lines.push("New users:", ...diff.newUsers.map((u) => `  + ${u}`));
  }

  return lines.join("\n") || "(no significant changes)";
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

import { writeFile, readFile } from "node:fs/promises";

export async function saveBaseline(path: string, snapshot: BaselineSnapshot): Promise<void> {
  await writeFile(path, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function loadBaseline(path: string): Promise<BaselineSnapshot | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as BaselineSnapshot;
  } catch {
    return null;
  }
}
