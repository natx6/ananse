import { Router } from "express";
import { streamText } from "ai";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createModelFromConfig } from "../../agent.js";
import type { AnanseConfig } from "../../utils.js";

function loadConfig(): AnanseConfig | null {
  try {
    const p = join(homedir(), ".ananse", "config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as AnanseConfig;
  } catch { return null; }
  return null;
}

export function createChatRouter() {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { message, mode } = req.body;
      if (!message) return res.status(400).json({ error: "message required" });

      const config = loadConfig();
      if (!config?.apiKey) return res.status(400).json({ error: "No API key configured" });

      const model = createModelFromConfig(config, (mode || "NORMAL").toLowerCase() as any);
      if (!model) return res.status(400).json({ error: `No model for ${config.provider}` });

      const systemPrompt = `You are Ananse, an AI assistant operating in ${mode || "NORMAL"} mode. Be conversational and natural — like you're chatting with a friend. Don't be robotic or use mission-brief language. Answer questions, help with tasks, and be helpful. Keep responses concise.`;

      const result = streamText({ model, system: systemPrompt, messages: [{ role: "user", content: message }], maxRetries: 1 });

      let response = "";
      for await (const event of result.fullStream) {
        if (event.type === "text-delta") response += event.text;
      }

      res.json({ response: response.trim() || "(no response)", mode: mode || "NORMAL" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
