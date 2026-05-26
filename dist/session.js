import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const SESSIONS_DIR = join(homedir(), ".ananse", "sessions");
const INDEX_PATH = join(SESSIONS_DIR, "index.json");
async function ensureSessionsDir() {
    if (!existsSync(SESSIONS_DIR)) {
        await mkdir(SESSIONS_DIR, { recursive: true });
    }
}
async function readIndex() {
    try {
        if (existsSync(INDEX_PATH)) {
            return JSON.parse(await readFile(INDEX_PATH, "utf-8"));
        }
    }
    catch { /* ignore */ }
    return {};
}
async function writeIndex(index) {
    await writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}
export function createSession(config, personality, fileCount, name) {
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
export function addMessage(session, message) {
    return {
        ...session,
        messages: [...session.messages, message],
        updatedAt: new Date().toISOString(),
    };
}
export async function saveSession(session) {
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
export async function loadSession(id) {
    try {
        const path = join(SESSIONS_DIR, `${id}.json`);
        if (!existsSync(path))
            return null;
        const raw = await readFile(path, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function loadSessionByName(name) {
    try {
        const index = await readIndex();
        const id = index[name];
        if (!id)
            return null;
        return loadSession(id);
    }
    catch {
        return null;
    }
}
export async function listSessions() {
    try {
        await ensureSessionsDir();
        const entries = await readdir(SESSIONS_DIR);
        const sessions = [];
        for (const entry of entries) {
            if (!entry.endsWith(".json") || entry === "index.json")
                continue;
            const session = await loadSession(entry.replace(".json", ""));
            if (session)
                sessions.push(session);
        }
        sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return sessions;
    }
    catch {
        return [];
    }
}
export async function listNamedSessions() {
    const index = await readIndex();
    const names = Object.keys(index);
    const sessions = [];
    for (const name of names) {
        const session = await loadSessionByName(name);
        if (session)
            sessions.push(session);
    }
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
}
//# sourceMappingURL=session.js.map