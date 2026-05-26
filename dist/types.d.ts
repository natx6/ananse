import type { AnanseConfig } from "./utils.js";
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
}
export type ToolAction = "read" | "write" | "edit" | "command" | "search" | "crawl";
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
}
export type { AnanseConfig };
//# sourceMappingURL=types.d.ts.map