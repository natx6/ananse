import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { minimatch } from "minimatch";

export type PolicyVerdict = "deny" | "allow" | "require_approval";

interface PolicyRule {
  action: string;   // tool name or "*"
  pattern: string;  // glob for the target path/command
  verdict: PolicyVerdict;
}

const DEFAULT_POLICY_PATH = resolve(".ananse.policy.yml");

let rules: PolicyRule[] | null = null;

function parsePolicyFile(content: string): PolicyRule[] {
  const doc = parseYaml(content) as Record<string, Record<string, string | string[]>> | undefined;
  if (!doc) return [];

  const result: PolicyRule[] = [];

  for (const verdict of ["deny", "require_approval", "allow"] as const) {
    const section = doc[verdict];
    if (!section) continue;

    for (const [action, patternOrPatterns] of Object.entries(section)) {
      const patterns = Array.isArray(patternOrPatterns) ? patternOrPatterns : [patternOrPatterns];
      for (const pattern of patterns) {
        result.push({ action, pattern, verdict });
      }
    }
  }

  return result;
}

export async function loadPolicy(path?: string): Promise<void> {
  const policyPath = path ?? DEFAULT_POLICY_PATH;
  if (!existsSync(policyPath)) {
    rules = [];
    return;
  }
  const content = await readFile(policyPath, "utf-8");
  rules = parsePolicyFile(content);
}

function globMatch(pattern: string, target: string): boolean {
  // Direct glob match using minimatch
  if (minimatch(target, pattern)) return true;
  // For command actions, also match if the command starts with the pattern
  if (target.startsWith(pattern)) return true;
  return false;
}

export function checkPolicy(action: string, target: string): PolicyVerdict {
  if (!rules) return "allow"; // No policy loaded = everything allowed

  let result: PolicyVerdict = "allow";

  for (const rule of rules) {
    const actionMatch = rule.action === "*" || rule.action === action;
    if (!actionMatch) continue;

    if (globMatch(rule.pattern, target)) {
      // Rules are ordered by priority: deny > require_approval > allow
      if (rule.verdict === "deny") return "deny";
      if (rule.verdict === "require_approval") result = "require_approval";
      // allow is the default, only overrides if nothing stricter was set
    }
  }

  return result;
}

export function setRules(newRules: PolicyRule[]): void {
  rules = newRules;
}

export function clearPolicy(): void {
  rules = null;
}
