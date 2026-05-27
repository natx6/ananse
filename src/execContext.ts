import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stealthDelay, isStealthEnabled, getCommandSubstitution } from "./stealth.js";

const execAsync = promisify(execFile);

type ExecResult = { stdout: string; stderr: string };
type ExecFunction = (command: string, timeout?: number) => Promise<ExecResult>;

let remoteExec: ExecFunction | null = null;

/**
 * Set a remote exec function that routes shell commands through SSH.
 * When set, all security tools' sh() calls go through this function.
 * Pass null to clear and return to local execution.
 */
export function setRemoteExec(fn: ExecFunction | null): void {
  remoteExec = fn;
}

export function getRemoteExec(): ExecFunction | null {
  return remoteExec;
}

/**
 * Run a shell command. Uses remote exec if set (e.g., SSH session),
 * otherwise runs locally via bash.
 */
export async function sh(command: string, timeout = 30_000): Promise<string> {
  // Command substitution: transparently replace loud commands
  // with quieter alternatives based on the target profile.
  const substitution = getCommandSubstitution(command);
  if (substitution) {
    command = substitution;
  }

  // Traffic shaping: adds random delay between tool calls when stealth is active.
  // This spaces out API requests (avoiding rate limits) AND mimics human pacing.
  if (isStealthEnabled()) {
    await stealthDelay();
  }

  if (remoteExec) {
    try {
      const result = await remoteExec(command, timeout);
      return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }
  try {
    const { stdout, stderr } = await execAsync("bash", ["-c", command], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (err) {
    const nodeErr = err as { stdout?: string; stderr?: string; message: string };
    const output = [nodeErr.stdout ?? "", nodeErr.stderr ?? ""].filter(Boolean).join("\n").trim();
    return output || `Error: ${nodeErr.message}`;
  }
}
