import { Command } from "commander";
import picocolors from "picocolors";
import WebSocket from "ws";
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

  c2.addCommand(task);

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
