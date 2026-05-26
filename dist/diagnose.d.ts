/**
 * Strip noise from terminal output and return the condensed error.
 *
 * - Removes ANSI color codes
 * - Strips node_modules paths
 * - Strips timestamps and progress noise
 * - For compiler commands: extracts just the structured errors
 * - Limits total length to avoid token waste
 */
export declare function condenseError(raw: string, command?: string): string;
/**
 * Detect if the output contains an error (non-zero exit or error keywords).
 * Returns a condensed error string, or null if the output seems clean.
 */
export declare function detectAndCondense(output: string, command?: string): string | null;
//# sourceMappingURL=diagnose.d.ts.map