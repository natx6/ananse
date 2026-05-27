import { readFile, writeFile, mkdir, appendFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  action: string;
  target: string;
  success: boolean;
  details?: string;
  previousHash: string;
  hash: string;
}

const AUDIT_DIR = join(homedir(), ".ananse", "audit");

function computeHash(data: string): string {
  return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}

function entryWithoutHash(entry: Omit<AuditEntry, "hash">): string {
  const { hash: _, ...rest } = entry as AuditEntry;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function computeEntryHash(entry: Omit<AuditEntry, "hash">): string {
  return computeHash(entryWithoutHash(entry));
}

async function ensureAuditDir(): Promise<void> {
  await mkdir(AUDIT_DIR, { recursive: true });
}

function auditPath(sessionId: string): string {
  return join(AUDIT_DIR, `${sessionId}.jsonl`);
}

export async function logAudit(entry: Omit<AuditEntry, "hash" | "previousHash">): Promise<void> {
  await ensureAuditDir();
  const path = auditPath(entry.sessionId);

  // Get the hash of the last entry in the file
  let previousHash = "0";
  try {
    if (existsSync(path)) {
      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
        previousHash = lastEntry.hash;
      }
    }
  } catch {
    previousHash = "0";
  }

  const entryWithPrevious: Omit<AuditEntry, "hash"> = {
    ...entry,
    previousHash,
  };

  const hash = computeEntryHash(entryWithPrevious);
  const fullEntry: AuditEntry = { ...entryWithPrevious, hash };

  await appendFile(path, JSON.stringify(fullEntry) + "\n", "utf-8");
}

export async function verifyAudit(sessionId: string): Promise<{
  valid: boolean;
  entries: number;
  error?: string;
}> {
  const path = auditPath(sessionId);
  if (!existsSync(path)) {
    return { valid: false, entries: 0, error: "Audit file not found" };
  }

  const content = await readFile(path, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  let previousHash = "0";
  let valid = true;
  let error: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]) as AuditEntry;

    // Check previous hash link
    if (entry.previousHash !== previousHash) {
      valid = false;
      error = `Hash chain broken at entry ${i + 1}: expected previousHash "${previousHash}", got "${entry.previousHash}"`;
      break;
    }

    // Recompute entry hash
    const { hash, ...rest } = entry;
    const recomputedHash = computeEntryHash(rest);
    if (recomputedHash !== hash) {
      valid = false;
      error = `Entry ${i + 1} hash mismatch: expected "${hash}", recomputed "${recomputedHash}"`;
      break;
    }

    previousHash = hash;
  }

  return { valid, entries: lines.length, error };
}

export async function listAuditSessions(): Promise<string[]> {
  await ensureAuditDir();
  const files = await readdir(AUDIT_DIR);
  return files
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""));
}
