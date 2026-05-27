import { confirm, isCancel } from "@clack/prompts";
import pc from "picocolors";
import type { ToolAction } from "./types.js";
import { checkPolicy } from "./policy.js";

/** Set to true via --dangerously-skip-permissions to bypass all prompts */
export let dangerousMode = false;

export function setDangerousMode(enabled: boolean): void {
  dangerousMode = enabled;
}

/**
 * Request user permission for a tool action.
 *
 * First checks the policy engine (`.ananse.policy.yml`):
 * - `deny` → immediately reject
 * - `allow` → auto-approve without prompting
 * - `require_approval` → show interactive prompt
 *
 * Auto-approves `read` and `search` actions when no policy is set.
 * For `write`, `edit`, and `command` actions it shows an interactive
 * confirmation prompt via @clack/prompts — unless dangerous mode is on
 * (bypasses everything), or policy says "allow".
 *
 * @param type    - The kind of action being performed.
 * @param target  - The file path, command string, or search pattern.
 * @param details - Optional extra context shown in the prompt.
 * @returns `true` when approved, `false` when denied or cancelled.
 */
export async function requestPermission(
  type: ToolAction,
  target: string,
  details?: string,
): Promise<boolean> {
  /* Dangerous mode — skip everything */
  if (dangerousMode) return true;

  /* Policy check — deny takes precedence */
  const verdict = checkPolicy(type, target);
  if (verdict === "deny") {
    console.error(pc.red(`\n  Policy denied: ${type} on "${target}"`));
    return false;
  }
  if (verdict === "allow") return true;

  /* verdict === "require_approval" (or no policy) — use existing logic */

  /* Auto-approve read-only actions */
  if (type === "read" || type === "search") {
    return true;
  }

  /* Build a contextual prompt message */
  const label = permissionLabel(type, target);
  let message = label;
  if (details) {
    message += `
${pc.dim(details)}`;
  }

  /* Show the confirmation dialog */
  const result = await confirm({ message });

  if (isCancel(result)) {
    return false;
  }

  return result;
}

function permissionLabel(type: ToolAction, target: string): string {
  switch (type) {
    case "write":
      return `${pc.yellow("Write to")} ${pc.cyan(target)}`;
    case "edit":
      return `${pc.yellow("Edit")} ${pc.cyan(target)}`;
    case "command":
      return `${pc.yellow("Run command:")} ${pc.cyan(target)}`;
    default:
      return `${pc.yellow(type)} ${pc.cyan(target)}`;
  }
}
