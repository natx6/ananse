import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { configGet, configSet } from "./configcmd.js";

const mockFiles = new Map<string, string>();
let mockExists = new Set<string>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExists.has(path),
}));

vi.mock("node:fs/promises", () => ({
  readFile: async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) throw new Error("ENOENT");
    return content;
  },
  writeFile: async (path: string, content: string) => {
    mockFiles.set(path, content);
    mockExists.add(path);
  },
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

// Capture console output
let consoleOutput: string[] = [];
const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  mockFiles.clear();
  mockExists.clear();
  consoleOutput = [];
  console.log = (...args: string[]) => {
    consoleOutput.push(args.join(" "));
  };
  console.error = (...args: string[]) => {
    consoleOutput.push(args.join(" "));
  };
});

afterAll(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe("configSet", () => {
  it("sets a valid key-value pair", async () => {
    await configSet("provider", "openai");
    expect(consoleOutput[0]).toContain("Set");

    const raw = mockFiles.get("/home/test/.ananse/config.json");
    expect(raw).toBeTruthy();
    const config = JSON.parse(raw!);
    expect(config.provider).toBe("openai");
  });

  it("rejects invalid keys", async () => {
    await configSet("invalidKey", "value");
    expect(consoleOutput[0]).toContain("Invalid key");
    expect(mockFiles.size).toBe(0); // no file written
  });

  it("persists multiple keys", async () => {
    await configSet("provider", "anthropic");
    await configSet("model", "claude-sonnet-4-20250514");
    await configSet("apiKey", "sk-test-key-12345");

    const raw = mockFiles.get("/home/test/.ananse/config.json");
    const config = JSON.parse(raw!);
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.apiKey).toBe("sk-test-key-12345");
  });

  it("overwrites existing values", async () => {
    await configSet("provider", "anthropic");
    await configSet("provider", "openai");

    const config = JSON.parse(mockFiles.get("/home/test/.ananse/config.json")!);
    expect(config.provider).toBe("openai");
  });
});

describe("configGet", () => {
  beforeEach(async () => {
    // Seed config
    const config = {
      provider: "anthropic",
      apiKey: "sk-test-key-1234567890",
      model: "claude-sonnet-4-20250514",
    };
    mockFiles.set("/home/test/.ananse/config.json", JSON.stringify(config));
    mockExists.add("/home/test/.ananse/config.json");
  });

  it("shows all keys", async () => {
    await configGet();
    expect(consoleOutput.join(" ")).toContain("provider");
    expect(consoleOutput.join(" ")).toContain("apiKey");
    expect(consoleOutput.join(" ")).toContain("model");
  });

  it("shows a specific key", async () => {
    await configGet("provider");
    expect(consoleOutput[0]).toContain("provider");
    expect(consoleOutput[0]).toContain("anthropic");
  });

  it("masks apiKey value", async () => {
    await configGet("apiKey");
    // Should show first 8 + "…" + last 4
    expect(consoleOutput[0]).toContain("sk-test-");
    expect(consoleOutput[0]).toContain("…");
    expect(consoleOutput[0]).toContain("7890");
    // Should NOT show the full key
    const fullKey = consoleOutput.find((l) => l.includes("sk-test-key-1234567890"));
    expect(fullKey).toBeUndefined();
  });

  it("shows warning for missing key", async () => {
    await configGet("nonexistent");
    expect(consoleOutput[0]).toContain("not set");
  });

  it("shows empty message when no config", async () => {
    mockFiles.clear();
    mockExists.clear();
    await configGet();
    expect(consoleOutput[0]).toContain("empty");
  });
});
