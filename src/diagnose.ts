// ---------------------------------------------------------------------------
// Terminal noise stripping
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const CARRIAGE_RETURN_RE = /\r[^\n]*/g;

const NODE_MODULES_RE = /\/node_modules\/[^:"]*/g;

const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z?\s*/g;

const NUMBERS_IN_BRACKETS_RE = /\[\d+[/,]\d+\]/g;

const WEBPACK_STATS_RE = /webpack\s+\d+\.\d+\.\d+\s.*/gi;

// ---------------------------------------------------------------------------
// Compiler-specific extractors
// ---------------------------------------------------------------------------

const TSC_ERROR_RE = /(src\/.*\.tsx?\(\d+,\d+\):?\s*error\s*(?:TS\d+)?:?[\s\S]*?)(?=\n\s*\n|\n(?:\w|$))/g;

const RUSTC_ERROR_RE = /(error\[E\d+\]:[\s\S]*?)(?=\n\s*(?:error|warning|\d+ errors|$))/g;

const GO_ERROR_RE = /(^.*\.go:\d+:\d+:[\s\S]*?)(?=\n\t|$)/gm;

function extractCompilerErrors(raw: string): string[] {
  const errors: string[] = [];

  // TypeScript
  let m: RegExpExecArray | null;
  const tscRe = new RegExp(TSC_ERROR_RE);
  while ((m = tscRe.exec(raw)) !== null) {
    errors.push(m[1].trim());
  }

  // Rust
  const rustRe = new RegExp(RUSTC_ERROR_RE);
  while ((m = rustRe.exec(raw)) !== null) {
    errors.push(m[1].trim());
  }

  // Go
  const goRe = new RegExp(GO_ERROR_RE);
  while ((m = goRe.exec(raw)) !== null) {
    errors.push(m[1].trim());
  }

  return errors;
}

// ---------------------------------------------------------------------------
// isCompileCommand — check if a command is likely a compiler
// ---------------------------------------------------------------------------

function isCompileCommand(command: string): boolean {
  const cmd = command.toLowerCase();
  return cmd.includes("tsc") || cmd.includes("build") || cmd.includes("cargo") || cmd.includes("rustc") || cmd.includes("go build") || cmd.includes("gcc") || cmd.includes("clang");
}

// ---------------------------------------------------------------------------
// condenseError — main entry point
// ---------------------------------------------------------------------------

/**
 * Strip noise from terminal output and return the condensed error.
 *
 * - Removes ANSI color codes
 * - Strips node_modules paths
 * - Strips timestamps and progress noise
 * - For compiler commands: extracts just the structured errors
 * - Limits total length to avoid token waste
 */
export function condenseError(raw: string, command?: string): string {
  if (!raw) return "";

  // Step 1: strip ANSI
  let clean = raw.replace(ANSI_RE, "");

  // Step 2: strip \r (carriage return noise)
  clean = clean.replace(CARRIAGE_RETURN_RE, "");

  // Step 3: strip node_modules paths
  clean = clean.replace(NODE_MODULES_RE, " /node_modules/…");

  // Step 4: strip timestamps
  clean = clean.replace(TIMESTAMP_RE, "");

  // Step 5: strip webpack stats
  clean = clean.replace(WEBPACK_STATS_RE, "");

  // Step 6: strip progress numbers
  clean = clean.replace(NUMBERS_IN_BRACKETS_RE, "");

  // Step 7: collapse repeated newlines
  clean = clean.replace(/\n{3,}/g, "\n\n");

  // Step 8: for compiler commands, extract structured errors
  if (command && isCompileCommand(command)) {
    const extracted = extractCompilerErrors(clean);
    if (extracted.length > 0) {
      clean = extracted.join("\n---\n");
    }
  }

  // Step 9: truncate to 3000 chars max (save tokens)
  if (clean.length > 3000) {
    clean = clean.slice(0, 3000) + `\n\n... (truncated ${raw.length - 3000} more characters)`;
  }

  return clean.trim();
}

/**
 * Detect if the output contains an error (non-zero exit or error keywords).
 * Returns a condensed error string, or null if the output seems clean.
 */
export function detectAndCondense(output: string, command?: string): string | null {
  if (!output || output.trim() === "(no output)") return null;

  // Check for error indicators
  const errorKeywords = /\b(error|failed|fatal|panic|exception|traceback|killed|exit code)\b/i;
  if (!errorKeywords.test(output)) return null;

  return condenseError(output, command);
}
