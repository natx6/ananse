import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AnanseConfig } from "./utils.js";
import type { AnanseMode } from "./mode.js";

/**
 * Create an Ollama-compatible model via the OpenAI SDK.
 * Ollama exposes an OpenAI-compatible API at localhost:11434/v1.
 */
export function createOllamaModel(modelName?: string): LanguageModel {
  const openai = createOpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama doesn't require a real key
  });
  return openai.chat(modelName ?? "llama3.2");
}

/**
 * Resolve the best model based on the current mode and config.
 * In offense mode, prefers local models (air-gap safe).
 * In defense mode, prefers cloud models (more capable for analysis).
 */
export function resolveModeModel(config: AnanseConfig, mode: AnanseMode): LanguageModel | null {
  // If the user has explicitly set a model in config, use it regardless
  if (config.model && config.provider !== "ollama") {
    return null; // Let the standard createModelFromConfig handle it
  }

  // Ollama takes priority when provider is set
  if (config.provider === "ollama") {
    return createOllamaModel(config.model);
  }

  // Mode-based defaults (only if no explicit provider/model is set)
  if (mode === "offense") {
    // For offense, try to use local model for air-gap safety
    // but only if no other provider is configured
    if (!config.provider && !config.apiKey) {
      return createOllamaModel();
    }
  }

  return null; // Fall back to standard model resolution
}
