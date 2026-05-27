import type { ToolResult } from "../types.js";
import type { TargetProfile } from "../profiler.js";
import type { StealthConfig } from "../stealth.js";

// ---------------------------------------------------------------------------
// Status & Config
// ---------------------------------------------------------------------------

export type C2TaskStatus = "pending" | "delivered" | "running" | "completed" | "failed" | "cancelled";

export interface ImplantConfig {
  beaconInterval: number;      // ms between beacons
  stealthConfig: StealthConfig | null;
}

// ---------------------------------------------------------------------------
// Implant
// ---------------------------------------------------------------------------

export interface Implant {
  id: string;
  name: string;
  targetHost: string;
  status: "active" | "dead" | "destroyed";
  firstSeen: string;           // ISO timestamp
  lastSeen: string;
  version: string;
  profile: TargetProfile | null;
  tags: string[];
  config: ImplantConfig;
}

export interface ImplantHeartbeat {
  implantId: string;
  status: "active" | "running_task";
  uptime: number;              // seconds
  loadavg: [number, number, number];
  profile?: Partial<TargetProfile>;
  pendingResults: PendingResult[];
}

export interface ImplantRegistration {
  id: string;
  name: string;
  targetHost: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface PendingResult {
  taskId: string;
  sequenceNum: number;
  success: boolean;
  data: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  rawOutput?: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface C2Task {
  taskId: string;
  implantId: string;
  type: string;                   // matches tool name (recon_processes, etc.)
  params: Record<string, unknown>;
  status: C2TaskStatus;
  result: ToolResult | null;
  createdAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  operatorId: string;
  priority: number;
}

export interface C2TaskAssignment {
  taskId: string;
  type: string;
  params: Record<string, unknown>;
}

export interface CreateTaskRequest {
  implantId: string;
  type: string;
  params?: Record<string, unknown>;
  priority?: number;
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export interface BeaconResponse {
  ackedResults: string[];
  tasks: C2TaskAssignment[];
  config: ImplantConfig;
  command: "none" | "selfdestruct" | "sleep";
  commandParam?: string;
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export interface FleetSummary {
  total: number;
  active: number;
  dead: number;
  implants: Implant[];
}

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface C2ServerConfig {
  port: number;
  host: string;
  apiKey: string;
  implantToken: string;
  dbPath: string;
  checkinTimeout: number;         // ms before marking dead (default 600000)
  stalePruneInterval: number;     // ms between stale sweeps (default 60000)
}
