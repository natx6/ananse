import type { AnanseConfig } from "./utils.js";
/**
 * Run a self-correcting build loop using ToolLoopAgent.
 * Executes the build command, detects errors, fixes code, and retries
 * up to N steps.
 */
export declare function runBuildLoop(buildCommand: string, config: AnanseConfig): Promise<void>;
//# sourceMappingURL=builder.d.ts.map