import { z } from "zod";
import type { AnanseConfig } from "./utils.js";
import type { ToolResult } from "./types.js";
export declare const patchSchema: z.ZodObject<{
    filePath: z.ZodString;
    findText: z.ZodString;
    replaceWith: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
    findText: string;
    replaceWith: string;
}, {
    filePath: string;
    findText: string;
    replaceWith: string;
}>;
export declare const patchSetSchema: z.ZodObject<{
    patches: z.ZodArray<z.ZodObject<{
        filePath: z.ZodString;
        findText: z.ZodString;
        replaceWith: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        filePath: string;
        findText: string;
        replaceWith: string;
    }, {
        filePath: string;
        findText: string;
        replaceWith: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    patches: {
        filePath: string;
        findText: string;
        replaceWith: string;
    }[];
}, {
    patches: {
        filePath: string;
        findText: string;
        replaceWith: string;
    }[];
}>;
export type Patch = z.infer<typeof patchSchema>;
export declare function applyPatches(patches: Patch[]): Promise<{
    success: boolean;
    results: string[];
}>;
export declare function generatePatches(filePath: string, description: string, config: AnanseConfig): Promise<Patch[]>;
export declare function createBatchEditTool(): import("ai").Tool<{
    patches: {
        filePath: string;
        findText: string;
        replaceWith: string;
    }[];
}, ToolResult>;
//# sourceMappingURL=patch.d.ts.map