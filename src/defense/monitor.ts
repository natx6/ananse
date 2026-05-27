import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import type { ToolResult } from "../types.js";

const FIM_DIR = join(homedir(), ".ananse", "fim");

interface FimSnapshot {
  [path: string]: { hash: string; mtime: string };
}

async function ensureFimDir(): Promise<void> {
  await mkdir(FIM_DIR, { recursive: true });
}

/**
 * File integrity monitoring — snapshot critical files and detect changes.
 */
export function createMonitorFimSnapshotTool() {
  return tool({
    description: "Take a snapshot of critical system files (binaries, /etc, systemd) and compute their SHA-256 hashes. Run before and after changes to detect tampering.",
    inputSchema: z.object({
      name: z.string().describe("Snapshot name (e.g., 'pre-deploy', 'baseline')"),
      paths: z.array(z.string()).optional().describe("Paths to monitor (default: /bin/ls, /bin/ps, /bin/ss, /etc)"),
    }),
    execute: async ({ name, paths }): Promise<ToolResult> => {
      await ensureFimDir();
      const monitorPaths = paths ?? ["/bin/ls", "/bin/ps", "/bin/ss", "/sbin/init", "/etc/passwd", "/etc/shadow", "/etc/sudoers"];
      const snapshot: FimSnapshot = {};

      for (const filePath of monitorPaths) {
        try {
          const content = await readFile(filePath);
          const hash = crypto.createHash("sha256").update(content).digest("hex");
          const stat = await import("node:fs/promises").then((m) => m.stat(filePath));
          snapshot[filePath] = { hash, mtime: stat.mtime.toISOString() };
        } catch {
          snapshot[filePath] = { hash: "FILE_NOT_FOUND", mtime: "" };
        }
      }

      const snapshotPath = join(FIM_DIR, `${name}.json`);
      await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

      return { success: true, data: `Snapshot "${name}" saved to ${snapshotPath}\n${Object.keys(snapshot).length} files recorded.` };
    },
  });
}

/**
 * File integrity monitoring — compare current state against a snapshot.
 */
export function createMonitorFimCheckTool() {
  return tool({
    description: "Compare current file hashes against a saved snapshot. Detects unauthorized modifications, tampered binaries, and configuration drift.",
    inputSchema: z.object({
      name: z.string().describe("Snapshot name to compare against"),
    }),
    execute: async ({ name }): Promise<ToolResult> => {
      await ensureFimDir();
      const snapshotPath = join(FIM_DIR, `${name}.json`);
      if (!existsSync(snapshotPath)) {
        return { success: false, data: "", error: `Snapshot "${name}" not found.` };
      }

      const baseline = JSON.parse(await readFile(snapshotPath, "utf-8")) as FimSnapshot;
      const changes: string[] = [];

      for (const [filePath, baselineEntry] of Object.entries(baseline)) {
        try {
          const content = await readFile(filePath);
          const hash = crypto.createHash("sha256").update(content).digest("hex");
          if (hash !== baselineEntry.hash) {
            changes.push(`MODIFIED: ${filePath} (hash changed)`);
          }
        } catch {
          changes.push(`DELETED: ${filePath}`);
        }
      }

      if (changes.length === 0) {
        return { success: true, data: "No changes detected — all files match the snapshot." };
      }

      return { success: true, data: `⚠ ${changes.length} change(s) detected:\n${changes.join("\n")}` };
    },
  });
}

/**
 * Rootkit detection.
 */
export function createMonitorRootkitTool() {
  return tool({
    description: "Check for signs of rootkits: suspicious kernel modules, LD_PRELOAD hooks, hidden processes, and abnormal system call behavior.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const parts: string[] = [];

      // Check loaded kernel modules
      const modules = await sh("lsmod 2>/dev/null | head -40");
      parts.push(`=== Loaded Kernel Modules ===\n${modules || "(not available)"}`);

      // Check for suspicious modules
      const suspicious = await sh('lsmod 2>/dev/null | grep -iE "hide|rootkit|sneaky|backdoor" || echo "(none detected)"');
      parts.push(`\n=== Suspicious Modules ===\n${suspicious}`);

      // Check LD_PRELOAD
      const ldPreload = await sh("cat /etc/ld.so.preload 2>/dev/null || echo '(no ld.so.preload)'");
      parts.push(`\n=== LD_PRELOAD ===\n${ldPreload}`);

      // Check for hidden processes (/proc comparison)
      const procCount = await sh("ls /proc | grep -c '^[0-9]' 2>/dev/null || echo '0'");
      const psCount = await sh("ps aux 2>/dev/null | wc -l || echo '0'");
      parts.push(`\n=== Process Count ===\n/proc entries: ${procCount}\nps aux lines: ${psCount}`);

      // Check network interfaces in promiscuous mode
      const promisc = await sh("ip link 2>/dev/null | grep -i PROMISC || echo '(no promiscuous interfaces)'");
      parts.push(`\n=== Promiscuous Interfaces ===\n${promisc}`);

      return { success: true, data: parts.join("\n") };
    },
  });
}

/**
 * Process chain analysis.
 */
export function createMonitorProcessesTool() {
  return tool({
    description: "Analyze running processes with parent/child relationships. Useful for spotting unusual process chains (e.g., browser spawning a shell).",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const tree = await sh("ps auxf 2>/dev/null | head -60 || ps aux 2>/dev/null | head -60");
      return { success: true, data: tree || "No process info available." };
    },
  });
}

registerTool("monitor_fim_snapshot", "defense");
registerTool("monitor_fim_check", "defense");
registerTool("monitor_rootkit", "defense");
registerTool("monitor_processes", "defense");
