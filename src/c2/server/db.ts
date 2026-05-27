import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

let db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS implants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_host TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      profile TEXT,
      tags TEXT DEFAULT '[]',
      beacon_interval INTEGER NOT NULL DEFAULT 60000,
      stealth_config TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      implant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      completed_at TEXT,
      operator_id TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (implant_id) REFERENCES implants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_implant_status ON tasks(implant_id, status);
    CREATE INDEX IF NOT EXISTS idx_implants_status ON implants(status);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
