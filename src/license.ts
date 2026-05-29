import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import picocolors from "picocolors";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEACRNJk0i1E21gVLWoBmGVrDVkwkR/cTZYUdV5+reS3xM=
-----END PUBLIC KEY-----`;

export type Tier = "single" | "team" | "enterprise";

export interface License {
  tier: Tier;
  customer: string;
  expiry: string;
}

const CONFIG_DIR = join(homedir(), ".ananse");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

let cachedLicense: License | null | undefined = undefined;

export function getLicense(): License | null {
  if (cachedLicense !== undefined) return cachedLicense;

  try {
    if (!existsSync(CONFIG_PATH)) { cachedLicense = null; return null; }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    const encoded = cfg.license_key;
    if (!encoded || typeof encoded !== "string") { cachedLicense = null; return null; }

    const license = Buffer.from(encoded, "base64url").toString("utf-8");
    const dot = license.lastIndexOf(".");
    if (dot === -1) throw new Error("invalid format");

    const payload = license.slice(0, dot);
    const signature = license.slice(dot + 1);

    const pubKeyObj = crypto.createPublicKey({ key: PUBLIC_KEY_PEM, format: "pem", type: "spki" });
    const valid = crypto.verify(null, Buffer.from(payload, "utf-8"), pubKeyObj, Buffer.from(signature, "base64url"));
    if (!valid) throw new Error("invalid signature");

    const parts = payload.split(":");
    if (parts.length < 3) throw new Error("invalid payload");
    const tier = parts[0] as Tier;
    const customer = parts.slice(1, -1).join(":");
    const expiry = parts[parts.length - 1];

    if (!["single", "team", "enterprise"].includes(tier)) throw new Error("unknown tier");
    if (new Date(expiry) < new Date()) { cachedLicense = null; return null; }

    cachedLicense = { tier, customer, expiry };
    return cachedLicense;
  } catch { cachedLicense = null; return null; }
}

export function clearLicenseCache(): void { cachedLicense = undefined; }
export function getTier(): Tier { return getLicense()?.tier ?? "single"; }

export interface TierLimits {
  maxImplants: number;
  allowTeamSessions: boolean;
  allowLocalLLM: boolean;
}

const TIER_LIMITS: Record<Tier, TierLimits> = {
  single: { maxImplants: 5, allowTeamSessions: false, allowLocalLLM: false },
  team: { maxImplants: 50, allowTeamSessions: true, allowLocalLLM: false },
  enterprise: { maxImplants: Infinity, allowTeamSessions: true, allowLocalLLM: true },
};

export function getLimits(): TierLimits { return TIER_LIMITS[getTier()]; }

export function printLicenseStatus(): void {
  const license = getLicense();
  const tier = getTier();
  const limits = getLimits();

  if (license) {
    console.log(`\n  ${picocolors.green("✔")} Licensed: ${picocolors.white(license.tier.toUpperCase())} — ${license.customer}`);
    console.log(`    Expires: ${license.expiry}`);
  } else {
    console.log(`\n  ${picocolors.yellow("○")} No license key set. Running as ${picocolors.white("SINGLE")} tier.`);
  }
  console.log(`\n  ${picocolors.dim("Limits:")}`);
  console.log(`    Max implants:    ${limits.maxImplants === Infinity ? "∞" : limits.maxImplants}`);
  console.log(`    Team sessions:   ${limits.allowTeamSessions ? picocolors.green("✔") : picocolors.dim("—")}`);
  console.log(`    Local LLM:       ${limits.allowLocalLLM ? picocolors.green("✔") : picocolors.dim("—")}`);
  console.log("");
}

export function setLicenseKey(key: string): boolean {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) : {};
    cfg.license_key = key;
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
    clearLicenseCache();
    return true;
  } catch { return false; }
}
