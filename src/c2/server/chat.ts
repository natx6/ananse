import { Router } from "express";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read AI API key from config file as fallback.
 */
function readAiApiKey(): string | null {
  try {
    const cfgPath = join(homedir(), ".ananse", "config.json");
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as Record<string, string>;
      return cfg.apiKey || null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Simple AI chat endpoint for the web UI.
 * Forwards messages to OpenRouter and returns responses.
 * Uses C2_CHAT_API_KEY env var, then falls back to ~/.ananse/config.json
 */
export function createChatRouter(c2ApiKey: string, aiApiKey?: string) {
  const resolvedKey = aiApiKey || readAiApiKey() || c2ApiKey;
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { message, mode } = req.body;
      if (!message) {
        return res.status(400).json({ error: "message is required" });
      }

      const systemPrompt = `You are Ananse (Advanced Neural Agent for Network Security Exploitation), operating in ${mode || "OFFENSE"} mode. You are a C2 operator's AI assistant. Be direct and concise.`;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(502).json({ error: `API error: ${err}` });
      }

      const data = await response.json() as { choices?: Array<{ message: { content: string } }> };
      const text = data.choices?.[0]?.message?.content || "(no response)";
      res.json({ response: text, mode: mode || "OFFENSE" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
