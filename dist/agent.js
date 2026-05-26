import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createMistral } from "@ai-sdk/mistral";
import { streamText, stepCountIs } from "ai";
import picocolors from "picocolors";
import { spinner } from "@clack/prompts";
import crypto from "node:crypto";
import { createSession, addMessage, saveSession } from "./session.js";
import { createBatchEditTool } from "./patch.js";
import { createReadTool, createWriteTool, createEditTool, createCommandTool, createSearchTool, createCrawlTool, createBlastTool, } from "./tools.js";
// ---------------------------------------------------------------------------
// createSystemPrompt
// ---------------------------------------------------------------------------
/**
 * Builds a system prompt describing Ananse's role, the project context, and
 * the available tools.
 *
 * @param personality - Optional project personality file content (`.ananse.md`)
 * @param fileCount   - Number of non-ignored files discovered in the project
 * @returns           - The assembled system prompt string
 */
export function createSystemPrompt(personality, fileCount, userName) {
    const parts = [
        `You are Ananse, an AI assistant that helps with coding tasks. You are direct, capable, and efficient.`,
        ...(userName ? [`You are working with ${userName}. Naturally use their name in conversation when it feels right — greetings, praise, reassurance. But don't force it.`] : []),
        ``,
        `You are working in a project with ${fileCount} file${fileCount === 1 ? "" : "s"} in scope.`,
    ];
    if (personality) {
        parts.push(``, `The project has a personality file that describes its conventions and preferences:`, `<personality>`, personality, `</personality>`);
    }
    parts.push(``, `You have access to the following tools:`, `- read     — Read file contents from the project`, `- write    — Write new files to the project`, `- edit     — Make targeted edits to existing files`, `- command  — Run shell commands in the project directory`, `- search   — Search for files and content in the project`, `- crawl    — Trace import dependencies in TypeScript files`, `- patch    — Apply multiple find-replace edits across files in one call`, `- blast    — Check which files depend on a file before changing it`, ``, `Guidelines:`, `- Always explain your plan before executing actions.`, `- Prefer targeted edits over full-file rewrites when making changes.`, `- Ask for clarification when requirements are unclear or ambiguous.`, `- When proposing architectural decisions, explain trade-offs.`, `- If a tool execution fails, communicate the error clearly and suggest alternatives.`, `- Show relevant code snippets when explaining changes.`);
    return parts.join("\n");
}
// ---------------------------------------------------------------------------
// Helper: convert AI SDK response messages to internal Message format
// ---------------------------------------------------------------------------
/**
 * Converts raw AI SDK message data into the project's internal Message shape
 * so it can be persisted via addMessage / saveSession.
 */
function toInternalMessage(role, content, extra) {
    return {
        id: crypto.randomUUID(),
        role: role,
        content: typeof content === "string" ? content : JSON.stringify(content),
        toolCallId: extra?.toolCallId,
        toolName: extra?.toolName,
        timestamp: new Date().toISOString(),
    };
}
// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------
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
export function createModelFromConfig(config) {
    const providerName = config.provider ?? "anthropic";
    if (providerName === "anthropic") {
        const anthropic = createAnthropic({ apiKey: config.apiKey });
        return anthropic(config.model ?? "claude-sonnet-4-20250514");
    }
    else if (providerName === "openai") {
        const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
        return openai.chat(config.model ?? "gpt-4o");
    }
    else if (providerName === "google") {
        const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
        return google(config.model ?? "gemini-2.0-flash");
    }
    else if (providerName === "xai") {
        const xai = createXai({ apiKey: config.apiKey });
        return xai(config.model ?? "grok-2-1212");
    }
    else if (providerName === "deepseek") {
        const deepseek = createDeepSeek({ apiKey: config.apiKey });
        return deepseek(config.model ?? "deepseek-chat");
    }
    else if (providerName === "mistral") {
        const mistral = createMistral({ apiKey: config.apiKey });
        return mistral(config.model ?? "mistral-large-latest");
    }
    return null;
}
export async function runAgentLoop(userInput, config, personality, fileCount, userName, session) {
    // -----------------------------------------------------------------------
    // 1. Validate config
    // -----------------------------------------------------------------------
    if (!config.apiKey) {
        console.error(picocolors.red("Error: No API key found in Ananse config."));
        console.error(picocolors.red("Run `ananse configure` to set up your API key."));
        return;
    }
    // -----------------------------------------------------------------------
    // 2. Determine provider and create model
    // -----------------------------------------------------------------------
    const model = createModelFromConfig(config);
    if (!model) {
        console.error(picocolors.red(`Error: Unknown provider "${config.provider}".`));
        return;
    }
    // -----------------------------------------------------------------------
    // 3. Create or reuse session
    // -----------------------------------------------------------------------
    const currentSession = session ?? createSession(config, personality, fileCount);
    // -----------------------------------------------------------------------
    // 4. Build system prompt
    // -----------------------------------------------------------------------
    const systemPrompt = createSystemPrompt(personality, fileCount, userName);
    // -----------------------------------------------------------------------
    // 5. Create tool definitions
    // -----------------------------------------------------------------------
    const tools = {
        read: createReadTool(),
        write: createWriteTool(),
        edit: createEditTool(),
        command: createCommandTool(),
        search: createSearchTool(),
        crawl: createCrawlTool(),
        patch: createBatchEditTool(),
        blast: createBlastTool(),
    };
    // -----------------------------------------------------------------------
    // 6. Build message list from session history
    // -----------------------------------------------------------------------
    const messages = [];
    for (const msg of currentSession.messages) {
        if (msg.role === "user" || msg.role === "assistant") {
            messages.push({ role: msg.role, content: msg.content });
        }
    }
    messages.push({ role: "user", content: userInput });
    // -----------------------------------------------------------------------
    // 7. Run the streaming conversation
    // -----------------------------------------------------------------------
    try {
        const s = spinner();
        s.start("Thinking...");
        const result = streamText({
            model,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(25),
        });
        // 6a. Stop spinner on first token, then stream text
        let streamed = false;
        for await (const chunk of result.textStream) {
            if (!streamed) {
                streamed = true;
                s.stop("");
                process.stdout.write(picocolors.cyan("Ananse: "));
            }
            process.stdout.write(chunk);
        }
        // In case there's no text output at all (empty response)
        if (!streamed)
            s.stop("");
        // 6b. Collect the full conversation messages (including all tool-use
        //     rounds that occurred within maxSteps)
        const { messages: aiMessages } = await result.response;
        // 7c. Persist each message to the session
        for (const msg of aiMessages) {
            const m = msg;
            if (m.role === "user") {
                const content = typeof m.content === "string"
                    ? m.content
                    : Array.isArray(m.content)
                        ? m.content.map((p) => p.text ?? "").join("")
                        : "";
                if (content) {
                    addMessage(currentSession, toInternalMessage("user", content));
                }
            }
            else if (m.role === "assistant") {
                const content = m.content;
                // Flatten text content parts
                let textContent = "";
                if (typeof content === "string") {
                    textContent = content;
                }
                else if (Array.isArray(content)) {
                    for (const part of content) {
                        if (part.type === "text") {
                            textContent += part.text;
                        }
                        else if (part.type === "tool-call") {
                            addMessage(currentSession, toInternalMessage("assistant", JSON.stringify(part.input), {
                                toolCallId: part.toolCallId,
                                toolName: part.toolName,
                            }));
                        }
                    }
                }
                if (textContent) {
                    addMessage(currentSession, toInternalMessage("assistant", textContent));
                }
            }
            else if (m.role === "tool") {
                const content = m.content;
                for (const part of content) {
                    if (part.type === "tool-result") {
                        addMessage(currentSession, toInternalMessage("tool", typeof part.output === "string"
                            ? part.output
                            : JSON.stringify(part.output), { toolCallId: part.toolCallId }));
                    }
                }
            }
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(picocolors.red(`\nError during AI conversation: ${message}`));
        return currentSession;
    }
    // -----------------------------------------------------------------------
    // 8. Persist session to disk
    // -----------------------------------------------------------------------
    try {
        await saveSession(currentSession);
    }
    catch {
        console.warn(picocolors.yellow("\nWarning: Failed to save session to disk."));
    }
    return currentSession;
}
//# sourceMappingURL=agent.js.map