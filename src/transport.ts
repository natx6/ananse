import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { stealthDelay } from "./stealth.js";
import type { StealthConfig } from "./stealth.js";

const execFileAsync = promisify(execFile);

export interface SshTarget {
  user: string;
  host: string;
  port: number;
  keyPath?: string;
}

/**
 * Parse a target string like "user@host:port" or "user@host" into SshTarget.
 */
export function parseTarget(target: string): SshTarget {
  let user = "root";
  let host = target;
  let port = 22;

  // user@host
  const atIndex = target.indexOf("@");
  if (atIndex !== -1) {
    user = target.slice(0, atIndex);
    host = target.slice(atIndex + 1);
  }

  // host:port
  const colonIndex = host.lastIndexOf(":");
  if (colonIndex !== -1) {
    const portStr = host.slice(colonIndex + 1);
    const parsed = parseInt(portStr, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      port = parsed;
      host = host.slice(0, colonIndex);
    }
  }

  return { user, host, port };
}

/**
 * Build the SSH/SHOST string from target.
 */
export function targetHost(target: SshTarget): string {
  return `${target.user}@${target.host}`;
}

/**
 * Manages an SSH session to a remote host using ControlMaster multiplexing.
 */
export class SshSession {
  private target: SshTarget;
  private controlPath: string;
  private connected: boolean = false;
  private stealthConfig: StealthConfig | null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(target: SshTarget, stealthConfig?: StealthConfig | null) {
    this.target = target;
    this.controlPath = join(tmpdir(), `ananse-ssh-${randomUUID()}`);
    this.stealthConfig = stealthConfig ?? null;
  }

  /**
   * Update stealth config mid-session. Used by the profiler to
   * tune delays and command substitutions after profiling the target.
   */
  updateStealthConfig(config: StealthConfig): void {
    this.stealthConfig = config;
  }

  /**
   * Start periodic keepalive pings to prevent SSH connection dropout.
   * Runs `ssh -O check` on an interval to keep the ControlMaster socket alive.
   */
  keepalive(intervalMs: number = 60_000): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(async () => {
      try {
        await execFileAsync("ssh", [
          "-o", `ControlPath=${this.controlPath}`,
          "-O", "check",
          targetHost(this.target),
        ], { timeout: 10_000 });
      } catch {
        // Socket may be dead — caller will detect via exec() failures
      }
    }, intervalMs);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /**
   * Check whether the SSH control socket is still alive.
   */
  async isConnected(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await execFileAsync("ssh", [
        "-o", `ControlPath=${this.controlPath}`,
        "-O", "check",
        targetHost(this.target),
      ], { timeout: 5_000 });
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * Reconnect with exponential backoff (2s, 4s, 8s).
   * Returns true if reconnected successfully.
   */
  async reconnect(retries: number = 3): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      const delay = Math.min(2000 * Math.pow(2, i), 10_000);
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.close();
        await this.connect();
        return true;
      } catch {
        // Try next backoff
      }
    }
    return false;
  }

  /**
   * Open the SSH connection (establishes ControlMaster socket).
   */
  async connect(): Promise<void> {
    const args = this.buildBaseArgs();
    args.push("-f", "-N", "-M"); // Background fork, no command, ControlMaster
    try {
      await execFileAsync("ssh", args, { timeout: 30_000 });
      this.connected = true;
    } catch (err) {
      throw new Error(`SSH connection failed to ${targetHost(this.target)}: ${(err as Error).message}`);
    }
  }

  /**
   * Execute a command on the remote host and return stdout/stderr.
   * When stealth mode is active, adds a random delay before execution
   * to mimic human pacing and avoid burst detection.
   */
  async exec(command: string, timeout: number = 60_000): Promise<{ stdout: string; stderr: string }> {
    if (this.stealthConfig?.enabled) {
      await stealthDelay();
    }

    const args = this.buildBaseArgs();
    args.push(command);

    try {
      const { stdout, stderr } = await execFileAsync("ssh", args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err) {
      const nodeErr = err as { stdout?: string; stderr?: string; message: string };
      return {
        stdout: nodeErr.stdout ?? "",
        stderr: nodeErr.stderr ?? (err as Error).message,
      };
    }
  }

  /**
   * Copy a local file to the remote host via SCP.
   */
  async copy(localPath: string, remotePath: string): Promise<void> {
    const args = [
      "-P", String(this.target.port),
      "-o", `ControlPath=${this.controlPath}`,
    ];
    if (this.target.keyPath) {
      args.push("-i", this.target.keyPath);
    }
    args.push(localPath, `${targetHost(this.target)}:${remotePath}`);

    await execFileAsync("scp", args, { timeout: 30_000 });
  }

  /**
   * Close the SSH connection and clean up the control socket.
   */
  async close(): Promise<void> {
    this.stopKeepalive();
    if (!this.connected) return;
    try {
      await execFileAsync("ssh", [
        "-O", "exit",
        "-o", `ControlPath=${this.controlPath}`,
        targetHost(this.target),
      ], { timeout: 5_000 });
    } catch {
      // Best effort
    }
    this.connected = false;

    // Remove control socket file
    try {
      await unlink(this.controlPath);
    } catch {
      // Best effort — socket may already be gone
    }
  }

  private buildBaseArgs(): string[] {
    const args = [
      "-p", String(this.target.port),
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", `ControlPath=${this.controlPath}`,
    ];
    if (this.stealthConfig?.enabled) {
      args.push("-o", "LogLevel=QUIET");
    }
    if (this.target.keyPath) {
      args.push("-i", this.target.keyPath);
    }
    args.push(targetHost(this.target));
    return args;
  }
}
