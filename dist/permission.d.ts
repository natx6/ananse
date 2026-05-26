import type { ToolAction } from "./types.js";
/**
 * Request user permission for a tool action.
 *
 * Auto-approves `read` and `search` actions without prompting.
 * For `write`, `edit`, and `command` actions it shows an interactive
 * confirmation prompt via @clack/prompts.
 *
 * @param type    - The kind of action being performed.
 * @param target  - The file path, command string, or search pattern.
 * @param details - Optional extra context shown in the prompt.
 * @returns `true` when approved, `false` when denied or cancelled.
 */
export declare function requestPermission(type: ToolAction, target: string, details?: string): Promise<boolean>;
//# sourceMappingURL=permission.d.ts.map