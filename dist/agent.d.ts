import type { LanguageModel } from "ai";
import type { AnanseConfig } from "./utils.js";
import type { Session } from "./types.js";
/**
 * Builds a system prompt describing Ananse's role, the project context, and
 * the available tools.
 *
 * @param personality - Optional project personality file content (`.ananse.md`)
 * @param fileCount   - Number of non-ignored files discovered in the project
 * @returns           - The assembled system prompt string
 */
export declare function createSystemPrompt(personality: string | null, fileCount: number, userName: string | null): string;
/**
 * Runs a single turn of the Ananse conversation loop.
 *
 * Creates a session, builds the system prompt, determines the LLM provider
 * from the config, streams the response to stdout, collects the full
 * conversation, and persists it to disk.
 *
 * @param userInput   - The user's message for this turn
 * @param config      - Parsed Ananse configuration (provider, apiKey, model)
 * @param personality - Optional personality content from `.ananse.md`
 * @param fileCount   - Number of files in scope for the current project
 */
export declare function createModelFromConfig(config: AnanseConfig): LanguageModel | null;
export declare function runAgentLoop(userInput: string, config: AnanseConfig, personality: string | null, fileCount: number, userName: string | null, session?: Session): Promise<Session | undefined>;
//# sourceMappingURL=agent.d.ts.map