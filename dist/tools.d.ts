import type { ToolResult } from "./types.js";
export declare function createReadTool(): import("ai").Tool<{
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}, ToolResult>;
export declare function createWriteTool(): import("ai").Tool<{
    path: string;
    content: string;
}, ToolResult>;
export declare function createEditTool(): import("ai").Tool<{
    path: string;
    oldString: string;
    newString: string;
}, ToolResult>;
export declare function createCommandTool(): import("ai").Tool<{
    command: string;
    timeout?: number | undefined;
}, ToolResult>;
export declare function createSearchTool(): import("ai").Tool<{
    pattern: string;
}, ToolResult>;
export declare function createCrawlTool(): import("ai").Tool<{
    target: string;
    mode: "file" | "directory";
}, ToolResult>;
//# sourceMappingURL=tools.d.ts.map