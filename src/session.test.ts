import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSession,
  addMessage,
  saveSession,
  loadSession,
  loadSessionByName,
  listSessions,
  renameSession,
  deleteSession,
  searchSessions,
  forkSession,
  listNamedSessions,
} from "./session.js";

// Mock filesystem modules
const mockFiles = new Map<string, string>();
let mockExists = new Set<string>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExists.has(path),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) throw new Error("ENOENT");
    return content;
  },
  writeFile: async (path: string, content: string) => {
    mockFiles.set(path, content);
    mockExists.add(path);
  },
  readdir: async (path: string) => {
    // Return mock file entries from the sessions dir
    const entries: string[] = [];
    for (const key of mockFiles.keys()) {
      if (key.startsWith(path) && key.endsWith(".json") && !key.endsWith("index.json")) {
        const name = key.split("/").pop()!;
        entries.push(name);
      }
    }
    return entries;
  },
  rm: async (path: string) => {
    mockFiles.delete(path);
    mockExists.delete(path);
  },
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

let uuidCounter = 0;
vi.mock("node:crypto", () => ({
  randomUUID: () => {
    uuidCounter++;
    return `test-uuid-${uuidCounter}`;
  },
}));

beforeEach(() => {
  mockFiles.clear();
  mockExists.clear();
  uuidCounter = 0;
  // Ensure sessions dir "exists"
  mockExists.add("/home/test/.ananse/sessions");
});

describe("session CRUD", () => {
  it("createSession builds correct structure", () => {
    const config = { apiKey: "sk-test" };
    const session = createSession(config, "personality content", 42, "my-session");
    expect(session.id).toMatch(/^test-uuid-/);
    expect(session.name).toBe("my-session");
    expect(session.messages).toHaveLength(0);
    expect(session.fileCount).toBe(42);
    expect(session.personality).toBe("personality content");
    expect(session.config.apiKey).toBe("sk-test");
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it("createSession without optional name", () => {
    const session = createSession({}, null, 0);
    expect(session.name).toBeUndefined();
    expect(session.personality).toBeNull();
  });

  it("addMessage appends and updates updatedAt", () => {
    const session = createSession({}, null, 0);
    const msg = { id: "1", role: "user" as const, content: "hello", timestamp: new Date().toISOString() };
    addMessage(session, msg);

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello");
    expect(session.updatedAt).toBeTruthy();
  });

  it("addMessage mutates in place and returns session", () => {
    const session = createSession({}, null, 0);
    const msg = { id: "1", role: "user" as const, content: "test", timestamp: "" };
    const returned = addMessage(session, msg);
    expect(returned).toBe(session);
  });

  it("addMessage maintains insertion order", () => {
    const session = createSession({}, null, 0);
    addMessage(session, { id: "1", role: "user" as const, content: "first", timestamp: "" });
    addMessage(session, { id: "2", role: "assistant" as const, content: "second", timestamp: "" });
    addMessage(session, { id: "3", role: "user" as const, content: "third", timestamp: "" });
    expect(session.messages.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });
});

describe("saveSession and loadSession", () => {
  it("saves and loads a session by id", async () => {
    const session1 = createSession({}, null, 0, "test-session");
    addMessage(session1, { id: "1", role: "user" as const, content: "hello", timestamp: "" });

    await saveSession(session1);

    const loaded = await loadSession(session1.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test-session");
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe("hello");
  });

  it("returns null for nonexistent session", async () => {
    const loaded = await loadSession("nonexistent-id");
    expect(loaded).toBeNull();
  });

  it("updates name index on save", async () => {
    const session = createSession({}, null, 0, "named-session");
    const sessionId = session.id;
    await saveSession(session);

    // Index should exist
    const indexRaw = mockFiles.get("/home/test/.ananse/sessions/index.json");
    expect(indexRaw).toBeTruthy();
    const index = JSON.parse(indexRaw!);
    expect(index["named-session"]).toBe(sessionId);
  });

  it("loadSessionByName resolves from index", async () => {
    const session = createSession({}, null, 0, "bob-session");
    const sessionId = session.id;
    await saveSession(session);

    const loaded = await loadSessionByName("bob-session");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(sessionId);
  });

  it("loadSessionByName returns null for unknown name", async () => {
    const loaded = await loadSessionByName("nope");
    expect(loaded).toBeNull();
  });
});

describe("listSessions", () => {
  it("returns sessions sorted by updatedAt descending", async () => {
    const session1 = createSession({}, null, 0, "older");
    const session2 = createSession({}, null, 0, "newer");
    // Set distinct timestamps so sort order is deterministic
    session1.updatedAt = "2024-01-01T00:00:00.000Z";
    session2.updatedAt = "2024-06-01T00:00:00.000Z";

    await saveSession(session1);
    await saveSession(session2);

    const sessions = await listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe("newer");
    expect(sessions[1].name).toBe("older");
  });

  it("returns empty array when no sessions", async () => {
    const sessions = await listSessions();
    expect(sessions).toHaveLength(0);
  });

  it("lists only session files, not index.json", async () => {
    // Manually create index.json — listSessions should skip it
    mockFiles.set("/home/test/.ananse/sessions/index.json", JSON.stringify({}));
    mockExists.add("/home/test/.ananse/sessions/index.json");

    const session = createSession({}, null, 0, "real-session");
    await saveSession(session);

    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
  });
});

describe("renameSession", () => {
  it("renames and updates index", async () => {
    const session = createSession({}, null, 0, "old-name");
    await saveSession(session);

    const ok = await renameSession("old-name", "new-name");
    expect(ok).toBe(true);

    // Old name should not resolve
    expect(await loadSessionByName("old-name")).toBeNull();
    // New name should resolve
    const loaded = await loadSessionByName("new-name");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("new-name");
  });

  it("returns false for nonexistent name", async () => {
    const ok = await renameSession("ghost", "whatever");
    expect(ok).toBe(false);
  });
});

describe("deleteSession", () => {
  it("deletes by name", async () => {
    const session = createSession({}, null, 0, "delete-me");
    const sessionId = session.id;
    await saveSession(session);

    const ok = await deleteSession("delete-me");
    expect(ok).toBe(true);
    expect(await loadSession(sessionId)).toBeNull();
    expect(await loadSessionByName("delete-me")).toBeNull();
  });

  it("deletes by id", async () => {
    const session = createSession({}, null, 0, "by-id");
    const sessionId = session.id;
    await saveSession(session);

    const ok = await deleteSession(sessionId);
    expect(ok).toBe(true);
    expect(await loadSession(sessionId)).toBeNull();
  });

  it("returns false for nonexistent session", async () => {
    const ok = await deleteSession("ghost");
    expect(ok).toBe(false);
  });
});

describe("searchSessions", () => {
  it("finds matching messages across sessions", async () => {
    const s1 = createSession({}, null, 0);
    addMessage(s1, { id: "1", role: "user" as const, content: "hello world", timestamp: "" });
    await saveSession(s1);

    const s2 = createSession({}, null, 0);
    addMessage(s2, { id: "2", role: "user" as const, content: "goodbye world", timestamp: "" });
    await saveSession(s2);

    const results = await searchSessions("hello");
    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].content).toBe("hello world");
  });

  it("returns empty array when no matches", async () => {
    const s = createSession({}, null, 0);
    addMessage(s, { id: "1", role: "user" as const, content: "abc", timestamp: "" });
    await saveSession(s);

    const results = await searchSessions("xyz");
    expect(results).toHaveLength(0);
  });

  it("is case-insensitive", async () => {
    const s = createSession({}, null, 0);
    addMessage(s, { id: "1", role: "user" as const, content: "Hello World", timestamp: "" });
    await saveSession(s);

    const results = await searchSessions("hello");
    expect(results).toHaveLength(1);
  });
});

describe("forkSession", () => {
  it("forks a session with new name and same messages", async () => {
    const original = createSession({ apiKey: "key" }, "personality", 10, "original");
    addMessage(original, { id: "1", role: "user" as const, content: "hello", timestamp: "" });
    await saveSession(original);

    const fork = await forkSession("original", "forked");
    expect(fork).not.toBeNull();
    expect(fork!.name).toBe("forked");
    expect(fork!.messages).toHaveLength(1);
    expect(fork!.messages[0].content).toBe("hello");
    expect(fork!.config.apiKey).toBe("key");
    expect(fork!.personality).toBe("personality");
    expect(fork!.fileCount).toBe(10);
    expect(fork!.id).not.toBe(original.id);
    expect(fork!.id).toBeTruthy();
  });

  it("returns null for nonexistent source", async () => {
    const fork = await forkSession("ghost", "new-name");
    expect(fork).toBeNull();
  });
});

describe("listNamedSessions", () => {
  it("returns only sessions with names", async () => {
    const named = createSession({}, null, 0, "has-name");
    await saveSession(named);

    const unnamed = createSession({}, null, 0);
    await saveSession(unnamed);

    const namedSessions = await listNamedSessions();
    expect(namedSessions).toHaveLength(1);
    expect(namedSessions[0].name).toBe("has-name");
  });

  it("returns sessions sorted by updatedAt", async () => {
    const a = createSession({}, null, 0, "alpha");
    const b = createSession({}, null, 0, "beta");
    a.updatedAt = "2024-01-01T00:00:00.000Z";
    b.updatedAt = "2024-06-01T00:00:00.000Z";
    await saveSession(a);
    await saveSession(b);

    const named = await listNamedSessions();
    expect(named).toHaveLength(2);
    expect(named[0].name).toBe("beta"); // most recent first
    expect(named[1].name).toBe("alpha");
  });
});
