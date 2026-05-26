import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AnanseConfig } from "./utils.js";
import type { Message, Session } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".ananse", "sessions");
const INDEX_PATH = join(SESSIONS_DIR, "index.json");

interface SessionIndex {
  [name: string]: string; // name -> session ID
}

async function ensureSessionsDir(): Promise<void> {
  if (!existsSync(SESSIONS_DIR)) {
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}

async function readIndex(): Promise<SessionIndex> {
  try {
    if (existsSync(INDEX_PATH)) {
      return JSON.parse(await readFile(INDEX_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

async function writeIndex(index: SessionIndex): Promise<void> {
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

export function createSession(
  config: AnanseConfig,
  personality: string | null,
  fileCount: number,
  name?: string,
): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    messages: [],
    config,
    personality,
    fileCount,
  };
}

export function addMessage(session: Session, message: Message): Session {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: new Date().toISOString(),
  };
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();

  // Save session file
  const path = join(SESSIONS_DIR, `${session.id}.json`);
  await writeFile(path, JSON.stringify(session, null, 2), "utf-8");

  // Update name index if session has a name
  if (session.name) {
    const index = await readIndex();
    index[session.name] = session.id;
    await writeIndex(index);
  }
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const path = join(SESSIONS_DIR, `${id}.json`);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function loadSessionByName(name: string): Promise<Session | null> {
  try {
    const index = await readIndex();
    const id = index[name];
    if (!id) return null;
    return loadSession(id);
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<Session[]> {
  try {
    await ensureSessionsDir();
    const entries = await readdir(SESSIONS_DIR);
    const sessions: Session[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry === "index.json") continue;
      const session = await loadSession(entry.replace(".json", ""));
      if (session) sessions.push(session);
    }

    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return sessions;
  } catch {
    return [];
  }
}

export async function listNamedSessions(): Promise<Session[]> {
  const index = await readIndex();
  const names = Object.keys(index);
  const sessions: Session[] = [];

  for (const name of names) {
    const session = await loadSessionByName(name);
    if (session) sessions.push(session);
  }

  sessions.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return sessions;
}
