import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import picocolors from "picocolors";

const CONFIG_PATH = join(homedir(), ".ananse", "config.json");

async function readConfig(): Promise<Record<string, string>> {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
    } catch { /* ignore */ }
  }
  return {};
}

async function writeConfig(config: Record<string, string>): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function configGet(key?: string): Promise<void> {
  const config = await readConfig();
  if (key) {
    if (key in config) {
      const val = key === "apiKey" && config[key].length > 12
        ? config[key].slice(0, 8) + "…" + config[key].slice(-4)
        : config[key];
      console.log(`  ${picocolors.white(key)}: ${picocolors.cyan(val)}`);
    } else {
      console.log(picocolors.yellow(`  "${key}" not set in config\n`));
    }
  } else {
    if (Object.keys(config).length === 0) {
      console.log(picocolors.dim("  Config is empty. Run `ananse configure` to set up.\n"));
      return;
    }
    for (const [k, v] of Object.entries(config)) {
      const val = k === "apiKey" && v.length > 12 ? v.slice(0, 8) + "…" + v.slice(-4) : v;
      console.log(`  ${picocolors.white(k)}: ${picocolors.cyan(val)}`);
    }
    console.log("");
  }
}

export async function configSet(key: string, value: string): Promise<void> {
  const allowed = ["apiKey", "provider", "model", "baseURL", "userName"];
  if (!allowed.includes(key)) {
    console.error(picocolors.red(`  Invalid key: "${key}". Allowed: ${allowed.join(", ")}\n`));
    return;
  }
  const config = await readConfig();
  config[key] = value;
  await writeConfig(config);
  console.log(picocolors.green(`  Set ${picocolors.white(key)} to ${picocolors.cyan(value)}\n`));
}
