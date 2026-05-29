import type { ReachSummary, Implant, C2Task, CreateTaskRequest } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_SERVER = "http://localhost:8443";

export interface C2ClientConfig {
  serverUrl: string;
  apiKey: string;
}

export class C2Client {
  private base: string;
  private headers: Record<string, string>;

  constructor(cfg: C2ClientConfig) {
    this.base = cfg.serverUrl.replace(/\/+$/, "");
    this.headers = {
      "Authorization": `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  // -----------------------------------------------------------------------
  // Reach
  // -----------------------------------------------------------------------

  async reach(): Promise<ReachSummary> {
    const res = await fetch(`${this.base}/api/v1/operator/reach`, { headers: this.headers });
    if (!res.ok) throw new Error(`reach request failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<ReachSummary>;
  }

  async implantDetail(id: string): Promise<Implant> {
    const res = await fetch(`${this.base}/api/v1/operator/reach/${encodeURIComponent(id)}`, { headers: this.headers });
    if (!res.ok) throw new Error(`implant detail failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<Implant>;
  }

  // -----------------------------------------------------------------------
  // Tasks
  // -----------------------------------------------------------------------

  async taskCreate(req: CreateTaskRequest): Promise<C2Task> {
    const res = await fetch(`${this.base}/api/v1/operator/task`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`task create failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<C2Task>;
  }

  async taskList(implantId?: string): Promise<C2Task[]> {
    const params = implantId ? `?implant=${encodeURIComponent(implantId)}` : "";
    const res = await fetch(`${this.base}/api/v1/operator/tasks${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(`task list failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<C2Task[]>;
  }

  async taskDetail(taskId: string): Promise<C2Task> {
    const res = await fetch(`${this.base}/api/v1/operator/task/${encodeURIComponent(taskId)}`, { headers: this.headers });
    if (!res.ok) throw new Error(`task detail failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<C2Task>;
  }

  async taskCancel(taskId: string): Promise<boolean> {
    const res = await fetch(`${this.base}/api/v1/operator/task/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`task cancel failed: ${res.status} ${await res.text()}`);
    const body = await res.json() as { cancelled: boolean };
    return body.cancelled;
  }

  // -----------------------------------------------------------------------
  // Kill
  // -----------------------------------------------------------------------

  async implantKill(implantId: string): Promise<string> {
    const res = await fetch(`${this.base}/api/v1/operator/implant/${encodeURIComponent(implantId)}/kill`, {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`kill failed: ${res.status} ${await res.text()}`);
    const body = await res.json() as { taskId: string; message: string };
    return body.taskId;
  }
}

// ---------------------------------------------------------------------------
// Resolve server URL and API key from env, flag, or config
// ---------------------------------------------------------------------------

export function resolveClientConfig(
  serverFlag?: string,
  keyFlag?: string,
): C2ClientConfig {
  const serverUrl = serverFlag ?? process.env.C2_SERVER_URL ?? DEFAULT_SERVER;
  const apiKey = keyFlag ?? process.env.C2_API_KEY ?? readConfigKey() ?? "";
  if (!apiKey) {
    console.error("Error: C2_API_KEY not set. Set it via env var, --key flag, or:");
    console.error("  ananse config set c2_api_key <key>");
    process.exit(1);
  }
  return { serverUrl, apiKey };
}

const ANANSE_CONFIG_PATH = join(homedir(), ".config", "ananse", "config.json");

function readConfigKey(): string | undefined {
  try {
    if (!existsSync(ANANSE_CONFIG_PATH)) return undefined;
    const raw = readFileSync(ANANSE_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    return cfg.c2_api_key || cfg.apiKey || undefined;
  } catch {
    return undefined;
  }
}
