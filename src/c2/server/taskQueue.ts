import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { C2Task, C2TaskAssignment, C2TaskStatus, CreateTaskRequest } from "../types.js";
import type { ToolResult } from "../../types.js";

export class TaskQueue {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Create a new task for an implant. Returns the task. */
  enqueue(req: CreateTaskRequest): C2Task {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const task: C2Task = {
      taskId,
      implantId: req.implantId,
      type: req.type,
      params: req.params ?? {},
      status: "pending",
      result: null,
      createdAt: now,
      deliveredAt: null,
      completedAt: null,
      operatorId: "",
      priority: req.priority ?? 1,
    };

    this.db.prepare(`
      INSERT INTO tasks (task_id, implant_id, type, params, status, created_at, operator_id, priority)
      VALUES (@taskId, @implantId, @type, @params, @status, @createdAt, @operatorId, @priority)
    `).run({
      ...task,
      params: JSON.stringify(task.params),
    });

    return task;
  }

  /** Get all tasks for an implant that are pending delivery. */
  poll(implantId: string): C2TaskAssignment[] {
    const rows = this.db.prepare(`
      SELECT task_id, type, params FROM tasks
      WHERE implant_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
    `).all(implantId) as { task_id: string; type: string; params: string }[];

    // Mark as delivered
    const now = new Date().toISOString();
    const ids = rows.map((r) => r.task_id);
    if (ids.length > 0) {
      this.db.prepare(`
        UPDATE tasks SET status = 'delivered', delivered_at = ? WHERE task_id IN (${ids.map(() => "?").join(",")})
      `).run(now, ...ids);
    }

    return rows.map((r) => ({
      taskId: r.task_id,
      type: r.type,
      params: JSON.parse(r.params),
    }));
  }

  /** Mark a task as completed with a result. */
  complete(taskId: string, result: ToolResult): C2Task | null {
    const now = new Date().toISOString();
    const status = result.success ? "completed" : "failed";

    this.db.prepare(`
      UPDATE tasks SET status = ?, result = ?, completed_at = ? WHERE task_id = ?
    `).run(status, JSON.stringify(result), now, taskId);

    return this.get(taskId);
  }

  /** Mark a task as running. */
  setRunning(taskId: string): void {
    this.db.prepare(`
      UPDATE tasks SET status = 'running' WHERE task_id = ?
    `).run(taskId);
  }

  /** Cancel a pending task. */
  cancel(taskId: string): boolean {
    const result = this.db.prepare(`
      UPDATE tasks SET status = 'cancelled' WHERE task_id = ? AND status = 'pending'
    `).run(taskId);
    return result.changes > 0;
  }

  /** Get a single task. */
  get(taskId: string): C2Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`).get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  /** List tasks for an implant. */
  list(implantId: string, limit = 50): C2Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE implant_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(implantId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  private rowToTask(row: Record<string, unknown>): C2Task {
    return {
      taskId: row.task_id as string,
      implantId: row.implant_id as string,
      type: row.type as string,
      params: JSON.parse(row.params as string),
      status: row.status as C2TaskStatus,
      result: row.result ? JSON.parse(row.result as string) : null,
      createdAt: row.created_at as string,
      deliveredAt: (row.delivered_at as string) ?? null,
      completedAt: (row.completed_at as string) ?? null,
      operatorId: (row.operator_id as string) ?? "",
      priority: (row.priority as number) ?? 1,
    };
  }
}
