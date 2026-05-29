import { homedir } from "node:os";
import { resolve, dirname, basename, sep } from "node:path";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { cwd } from "node:process";

/**
 * Attempts to find a real path from a user-provided path by trying
 * common alternatives and corrections.
 *
 * Returns the resolved path and what was fixed, or null if nothing works.
 */
export interface PathResolution {
  path: string;
  type: "file" | "dir";
  note?: string;
}

/** Common home dirs where users keep things */
const COMMON_HOME_DIRS = [
  "Documents",
  "Downloads",
  "Desktop",
  "Projects",
  "code",
  "dev",
  "src",
  "work",
  ".config",
];

/**
 * Resolve a user-provided path. Tries:
 * 1. As-is (relative to cwd or absolute)
 * 2. ~ expansion
 * 3. If relative and not found, try under ~/Documents/, ~/, and common dirs
 * 4. If basename matches a file in a parent dir
 */
export async function resolveUserPath(
  input: string,
  projectRoot?: string,
): Promise<PathResolution | null> {
  const home = homedir();
  const root = projectRoot ?? cwd();

  // Collect candidates
  const candidates: Array<{ path: string; note?: string }> = [];
  const seen = new Set<string>();

  const add = (p: string, note?: string) => {
    const normal = resolve(p);
    if (!seen.has(normal)) {
      seen.add(normal);
      candidates.push({ path: normal, note });
    }
  };

  // 1. Original path as-is
  add(input);
  if (input.startsWith("~")) {
    add(input.replace(/^~/, home), "expanded ~");
  }

  // 2. If input is relative, try against cwd and homedir
  if (!input.startsWith("/") && !input.startsWith("~")) {
    // Already added via resolve(input)
    // Try under home
    add(joinMaybe(home, input), `./ → ~/`);

    // Try under common home dirs
    for (const dir of COMMON_HOME_DIRS) {
      add(joinMaybe(home, dir, input), `./ → ~/${dir}/`);
    }

    // Try under project root
    add(joinMaybe(root, input));
  }

  // 3. Try just the basename in common locations
  const base = basename(input);
  if (base !== input && base !== "." && base !== "..") {
    add(joinMaybe(home, base), `just basename in ~/`);
    for (const dir of COMMON_HOME_DIRS) {
      add(joinMaybe(home, dir, base), `just basename in ~/${dir}/`);
    }
  }

  // 4. Check if input is an absolute path under a wrong root
  //    e.g. they wrote /home/user/documents/hyena instead of /home/user/Documents/hyena
  const lowerVariant = tryCaseVariants(input);
  if (lowerVariant) add(lowerVariant, "case correction");

  // Test each candidate
  for (const c of candidates) {
    try {
      if (existsSync(c.path)) {
        const st = statSync(c.path);
        return {
          path: c.path,
          type: st.isDirectory() ? "dir" : "file",
          note: c.note,
        };
      }
    } catch {
      // ignore perms, just skip
    }
  }

  // 5. Last resort: fuzzy find by basename in project
  if (base !== "." && base !== "..") {
    const fuzzy = await fuzzyFind(root, base, 3);
    if (fuzzy) return fuzzy;
  }

  return null;
}

/**
 * Try common case variations — lowercase first, capitalize first letter, etc.
 */
function tryCaseVariants(p: string): string | null {
  const parts = p.split(sep);
  let changed = false;
  const mapped = parts.map((part) => {
    // If a component doesn't exist as-is, try capitalized
    if (part.length > 0 && part[0] === part[0].toLowerCase()) {
      const cap = part[0].toUpperCase() + part.slice(1);
      if (cap !== part) {
        changed = true;
        return cap;
      }
    }
    return part;
  });
  return changed ? mapped.join(sep) : null;
}

/**
 * Shallow fuzzy find: look for files matching basename in the project root
 * (limited depth to avoid huge scans).
 */
async function fuzzyFind(
  root: string,
  base: string,
  maxDepth: number,
): Promise<PathResolution | null> {
  const lowerBase = base.toLowerCase();
  const results: Array<{ path: string; score: number }> = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = resolve(dir, entry.name);
        if (entry.name.toLowerCase() === lowerBase) {
          results.push({ path: full, score: 100 - depth * 10 });
        } else if (entry.name.toLowerCase().includes(lowerBase)) {
          results.push({ path: full, score: 50 - depth * 10 });
        }
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        }
      }
    } catch {
      // skip unreadable
    }
  }

  await walk(root, 0);

  if (results.length > 0) {
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    const st = statSync(best.path, { throwIfNoEntry: false });
    if (st) {
      return {
        path: best.path,
        type: st.isDirectory() ? "dir" : "file",
        note: `found via fuzzy match in project`,
      };
    }
  }

  return null;
}

/** Safe path join that handles empty segments */
function joinMaybe(...segments: string[]): string {
  return segments.filter(Boolean).join(sep);
}
