import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".ananse", "config.json");

/**
 * Read a single key from the ananse config file (~/.ananse/config.json).
 */
export function readConfigKey(key: string): string | undefined {
  try {
    if (!existsSync(CONFIG_PATH)) return undefined;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    return cfg[key] ?? undefined;
  } catch {
    return undefined;
  }
}
