import { readFile, writeFile, mkdir, appendFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

export interface KnowledgeEntry {
  id: string;
  type: "session" | "finding" | "vulnerability" | "note";
  content: string;
  tags: string[];
  timestamp: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

const KNOWLEDGE_DIR = join(homedir(), ".ananse", "knowledge");
const INDEX_PATH = join(KNOWLEDGE_DIR, "index.json");

interface InvertedIndex {
  [term: string]: string[]; // term → entry IDs
}

let index: InvertedIndex = {};
let entries: Map<string, KnowledgeEntry> = new Map();

async function ensureDir(): Promise<void> {
  await mkdir(KNOWLEDGE_DIR, { recursive: true });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function addToIndex(entry: KnowledgeEntry): void {
  const tokens = tokenize(`${entry.content} ${entry.tags.join(" ")}`);
  for (const token of new Set(tokens)) {
    if (!index[token]) index[token] = [];
    if (!index[token].includes(entry.id)) {
      index[token].push(entry.id);
    }
  }
}

export async function initKnowledge(): Promise<void> {
  await ensureDir();
  entries.clear();
  index = {};

  if (existsSync(INDEX_PATH)) {
    try {
      const content = await readFile(INDEX_PATH, "utf-8");
      const saved = JSON.parse(content) as { index: InvertedIndex; entries: KnowledgeEntry[] };
      index = saved.index;
      for (const entry of saved.entries) {
        entries.set(entry.id, entry);
      }
    } catch {
      // Corrupted index — rebuild
      await rebuildIndex();
    }
  }
}

export async function rebuildIndex(): Promise<void> {
  index = {};
  entries.clear();

  if (!existsSync(KNOWLEDGE_DIR)) return;

  const files = await readdir(KNOWLEDGE_DIR);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl") && f !== "index.json");

  for (const file of jsonlFiles) {
    try {
      const content = await readFile(join(KNOWLEDGE_DIR, file), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line) as KnowledgeEntry;
        entries.set(entry.id, entry);
        addToIndex(entry);
      }
    } catch {
      // Skip corrupted files
    }
  }

  await persistIndex();
}

async function persistIndex(): Promise<void> {
  await writeFile(
    INDEX_PATH,
    JSON.stringify({
      index,
      entries: Array.from(entries.values()),
    }),
    "utf-8",
  );
}

export async function storeKnowledge(entry: Omit<KnowledgeEntry, "id" | "timestamp">): Promise<string> {
  await ensureDir();

  const fullEntry: KnowledgeEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  // Append to the knowledge file
  const filePath = join(KNOWLEDGE_DIR, `${entry.type}s.jsonl`);
  await appendFile(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");

  // Update in-memory index
  entries.set(fullEntry.id, fullEntry);
  addToIndex(fullEntry);

  return fullEntry.id;
}

export function searchKnowledge(query: string, maxResults: number = 10): KnowledgeEntry[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Score entries by token match count
  const scores = new Map<string, number>();

  for (const token of tokens) {
    const matches = index[token] ?? [];
    for (const id of matches) {
      scores.set(id, (scores.get(id) ?? 0) + 1);
    }
  }

  // Sort by score (descending) and return top results
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([id]) => entries.get(id))
    .filter((e): e is KnowledgeEntry => e !== undefined);
}

export async function addSessionToKnowledge(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const combined = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
  await storeKnowledge({
    type: "session",
    content: combined,
    tags: ["session", sessionId],
    sessionId,
    metadata: { messageCount: String(messages.length) },
  });
}
