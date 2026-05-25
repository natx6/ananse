import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import fastGlob from "fast-glob";
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const CONFIG_PATH = `${homedir()}/.ananse/config.json`;
const PERSONALITY_PATH = resolve(".ananse.md");
// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------
export async function checkConfig() {
    try {
        if (!existsSync(CONFIG_PATH))
            return null;
        const raw = await readFile(CONFIG_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function checkPersonality() {
    try {
        if (!existsSync(PERSONALITY_PATH))
            return null;
        const content = await readFile(PERSONALITY_PATH, "utf-8");
        return { path: PERSONALITY_PATH, content };
    }
    catch {
        return null;
    }
}
export async function scanDirectory() {
    try {
        const files = await fastGlob("**/*", {
            ignore: ["node_modules/**", ".git/**", "dist/**"],
            dot: false,
            onlyFiles: true,
        });
        return files.length;
    }
    catch {
        return 0;
    }
}
// ---------------------------------------------------------------------------
// Orchestrated boot check (for future use)
// ---------------------------------------------------------------------------
export async function bootCheck() {
    const [config, personality, fileCount] = await Promise.all([
        checkConfig(),
        checkPersonality(),
        scanDirectory(),
    ]);
    return { config, personality, fileCount };
}
//# sourceMappingURL=utils.js.map