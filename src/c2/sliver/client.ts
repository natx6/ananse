/**
 * Sliver C2 gRPC Client
 *
 * Connects to a running Sliver server via gRPC and provides
 * the operations needed by ananse's AI tools.
 *
 * Requirements:
 *   1. Sliver server running with operator configured
 *   2. Operator config at ~/.sliver-client/configs/<name>.cfg
 *   3. Set C2_SLIVER_OPERATOR env var (or pass in tools)
 *
 * Uses @grpc/grpc-js for TLS-authenticated gRPC.
 * Proto definitions are loaded dynamically from the
 * sliver-protos/ directory (git submodule or manual copy).
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

// ── Types ──────────────────────────────────────────────────

export interface SliverSession {
  id: string;
  name: string;
  hostname: string;
  username: string;
  os: string;
  arch: string;
  transport: string;
  remoteAddress: string;
  lastCheckin: string;
  status: "active" | "dead" | "lost";
}

export interface SliverBeacon {
  id: string;
  name: string;
  hostname: string;
  username: string;
  os: string;
  arch: string;
  transport: string;
  interval: number;
  jitter: number;
  lastCheckin: string;
  nextCheckin: string;
  status: "active" | "dead";
}

export interface SliverTask {
  id: string;
  beaconId: string;
  type: string;
  status: "pending" | "sent" | "completed" | "failed" | "cancelled";
  result?: string;
  createdAt: string;
  completedAt?: string;
}

export interface SliverImplantConfig {
  os: string;
  arch: string;
  format: "exe" | "shared" | "service";
  name?: string;
  isBeacon?: boolean;
  beaconInterval?: number;
  beaconJitter?: number;
  mtlsHost?: string;
  mtlsPort?: number;
  httpHost?: string;
  httpPort?: number;
  dnsDomain?: string;
}

// ── Client ──────────────────────────────────────────────────

export class SliverClient {
  private client: any = null;
  private connected = false;
  private operatorName: string;

  constructor(operatorName: string = "ananse") {
    this.operatorName = operatorName;
  }

  /**
   * Connect to Sliver server via gRPC using the operator config.
   */
  async connect(): Promise<void> {
    const configPath = join(homedir(), ".sliver-client", "configs", `${this.operatorName}.cfg`);
    if (!existsSync(configPath)) {
      throw new Error(
        `Sliver operator config not found: ${configPath}\n` +
        `Create one with: sliver-client operators import <config-file>`
      );
    }

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const host = config.lhost || config.LHost || "localhost";
    const port = config.lport || config.LPort || 31337;
    // Certificates are stored as PEM strings in the operator config
    const cert = (config.certificate || config.Certificate || "");
    const key = (config.private_key || config.PrivateKey || "");
    const ca = (config.ca_certificate || config.CACertificate || "");

    // Find Sliver protobuf directory (search both src and dist relative paths)
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = resolve(scriptDir, "..", "..", "..");
    const protoDirCandidates = [
      resolve(scriptDir, "..", "sliver-protos"),                                // dist/c2/sliver-protos
      resolve(projectRoot, "src", "c2", "sliver-protos"),                       // src/c2/sliver-protos
      resolve(projectRoot, "sliver-protos"),                                     // project-root/sliver-protos
      resolve(join(homedir(), "sliver-protos")),
    ];

    let protoDir = "";
    for (const d of protoDirCandidates) {
      if (existsSync(join(d, "rpcpb", "services.proto"))) { protoDir = d; break; }
    }

    if (!protoDir) {
      throw new Error(
        "Sliver protobuf definitions not found.\n" +
        `Clone: git clone --depth 1 https://github.com/BishopFox/sliver.git /tmp/sliver\n` +
        `Link: ln -s /tmp/sliver/protobuf ${join(dirname(fileURLToPath(import.meta.url)), "..", "sliver-protos")}`
      );
    }

    const protoPath = join(protoDir, "rpcpb", "services.proto");
    const packageDef = await protoLoader.load(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });

    const rpcpb = grpc.loadPackageDefinition(packageDef) as any;
    const tlsCreds = grpc.credentials.createSsl(
      Buffer.from(ca),
      Buffer.from(key),
      Buffer.from(cert),
    );

    this.client = new rpcpb.rpcpb.SliverRPC(`${host}:${port}`, tlsCreds);
    this.connected = true;
  }

  isConnected(): boolean { return this.connected; }

  /**
   * Safely call a gRPC method with timeout.
   */
  private async call(method: string, args: any = {}): Promise<any> {
    if (!this.client) throw new Error("Not connected to Sliver server");
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 30);
      this.client[method](args, { deadline }, (err: any, res: any) => {
        if (err) reject(new Error(`Sliver ${method}: ${err.details || err.message}`));
        else resolve(res);
      });
    });
  }

  // ── Sessions & Beacons ─────────────────────────────────

  async getSessions(): Promise<SliverSession[]> {
    const res = await this.call("GetSessions", {});
    return (res?.Sessions || []).map((s: any) => ({
      id: s.ID,
      name: s.Name,
      hostname: s.Hostname,
      username: s.Username,
      os: s.OS,
      arch: s.Arch,
      transport: s.Transport,
      remoteAddress: s.RemoteAddress,
      lastCheckin: s.LastCheckin,
      status: s.IsDead ? "dead" : "active",
    }));
  }

  async getBeacons(): Promise<SliverBeacon[]> {
    const res = await this.call("GetBeacons", {});
    return (res?.Beacons || []).map((b: any) => ({
      id: b.ID,
      name: b.Name,
      hostname: b.Hostname,
      username: b.Username,
      os: b.OS,
      arch: b.Arch,
      transport: b.Transport,
      interval: b.Interval,
      jitter: b.Jitter,
      lastCheckin: b.LastCheckin,
      nextCheckin: b.NextCheckin,
      status: "active",
    }));
  }

  async getFleet(): Promise<{ sessions: SliverSession[]; beacons: SliverBeacon[] }> {
    const [sessions, beacons] = await Promise.all([
      this.getSessions().catch(() => []),
      this.getBeacons().catch(() => []),
    ]);
    return { sessions, beacons };
  }

  // ── Tasks (for beacons) ─────────────────────────────────

  async createTask(beaconId: string, type: string, params: Record<string, any> = {}): Promise<string> {
    // Use the appropriate RPC based on task type
    const res = await this.call("CreateTask", {
      BeaconID: beaconId,
      Type: type,
      Params: params,
    });
    return res?.TaskID || "";
  }

  async getTasks(beaconId: string): Promise<SliverTask[]> {
    const res = await this.call("GetTasks", { BeaconID: beaconId });
    return (res?.Tasks || []).map((t: any) => ({
      id: t.ID,
      beaconId: t.BeaconID,
      type: t.Type,
      status: t.Status,
      result: t.Result,
      createdAt: t.CreatedAt,
      completedAt: t.CompletedAt,
    }));
  }

  // ── Session commands ────────────────────────────────────

  async executeCommand(sessionId: string, command: string): Promise<string> {
    const res = await this.call("Execute", {
      SessionID: sessionId,
      Path: command,
    });
    return res?.Result || res?.Stdout || "(no output)";
  }

  async getSessionInfo(sessionId: string): Promise<string> {
    const res = await this.call("GetSession", { ID: sessionId });
    if (!res?.Session) return "Session not found";
    const s = res.Session;
    return [
      `Session: ${s.ID?.slice(0, 8)}`,
      `Name:   ${s.Name}`,
      `Host:   ${s.Hostname} (${s.Username})`,
      `OS:     ${s.OS}/${s.Arch}`,
      `Transport: ${s.Transport}`,
      `Remote: ${s.RemoteAddress}`,
      `Last:   ${s.LastCheckin}`,
    ].join("\n");
  }

  // ── Disconnect ──────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client?.close?.();
  }
}
