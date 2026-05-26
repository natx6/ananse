import { confirm, isCancel } from "@clack/prompts";
import pc from "picocolors";
import type { ToolAction } from "./types.js";

/** Set to true via --dangerously-skip-permissions to bypass all prompts */
export let dangerousMode = false;

export function setDangerousMode(enabled: boolean): void {
  dangerousMode = enabled;
}

/**
 * Request user permission for a tool action.
 *
 * Auto-approves `read` and `search` actions without prompting.
 * For `write`, `edit`, and `command` actions it shows an interactive
 * confirmation prompt via @clack/prompts — unless dangerous mode is on,
 * in which case everything is auto-approved.
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
