import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// Event types broadcast to WebSocket clients
// ---------------------------------------------------------------------------

export type WsEventType =
  | "implant_registered"
  | "implant_beacon"
  | "implant_dead"
  | "task_created"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "implant_killed"
  | "alert";

export interface WsEvent {
  type: WsEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type BroadcastFn = (event: WsEvent) => void;

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

/**
 * Attach a WebSocket event broadcast server to an HTTP server.
 * Clients connect at `/api/v1/operator/ws` and authenticate by sending
 * a JSON message `{ "token": "<api-key>" }` within 5 seconds.
 */
export function createWsBroadcaster(httpServer: Server, apiKey: string): BroadcastFn {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/v1/operator/ws" });

  // Track authenticated clients
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws, req) => {
    let authed = false;
    const authTimer = setTimeout(() => {
      if (!authed) {
        ws.close(4001, "auth timeout");
      }
    }, 5000);

    ws.on("message", (raw) => {
      if (authed) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.token === apiKey) {
          authed = true;
          clearTimeout(authTimer);
          clients.add(ws);
          ws.send(JSON.stringify({ type: "auth_ok", timestamp: new Date().toISOString() }));

          ws.on("close", () => {
            clients.delete(ws);
          });
        } else {
          ws.close(4001, "invalid token");
        }
      } catch {
        ws.close(4001, "invalid auth message");
      }
    });
  });

  // Broadcast function — sends event to all authenticated clients
  const broadcast: BroadcastFn = (event) => {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  };

  return broadcast;
}
