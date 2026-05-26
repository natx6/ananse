import type { ToolAction } from "./types.js";
/** Set to true via --dangerously-skip-permissions to bypass all prompts */
export declare let dangerousMode: boolean;
export declare function setDangerousMode(enabled: boolean): void;
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
export declare function requestPermission(type: ToolAction, target: string, details?: string): Promise<boolean>;
//# sourceMappingURL=permission.d.ts.map