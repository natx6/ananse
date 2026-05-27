import type { AnanseConfig } from "./utils.js";
import type { AnanseMode } from "./mode.js";

export type { AnanseMode };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  config: AnanseConfig;
  personality: string | null;
  fileCount: number;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export type ToolAction = "read" | "write" | "edit" | "command" | "search" | "crawl" | "patch" | "blast" | "subagent" | "harden" | "recon" | "privesc" | "persistence" | "exploit" | "report" | "monitor" | "compliance" | "sbom";

export interface PermissionRequest {
  id: string;
  type: ToolAction;
  target: string;
  details?: string;
}

export interface ToolResult {
  success: boolean;
  data: string;
  error?: string;
  analysis?: string;
}

export type { AnanseConfig };
