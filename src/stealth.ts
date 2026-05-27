/**
 * Stealth configuration for undetectable remote assessment.
 *
 * When enabled, the transport layer adds random delays between commands
 * (traffic shaping), and tool factories substitute loud commands with
 * subtler alternatives.
 *
 * When a target profile is available, delays and substitutions are tuned
 * dynamically based on the target's detected defenses.
 */

export type ThreatLevel = "clean" | "low" | "medium" | "high";

export interface StealthConfig {
  enabled: boolean;

  /** Minimum delay in ms between commands (default: 2000) */
  minDelay: number;

  /** Maximum delay in ms between commands (default: 8000) */
  maxDelay: number;

  /**
   * When true, high-risk commands are skipped or replaced with
   * subtler alternatives (e.g. no sudo -l, no full FS scans).
   */
  avoidHighRiskCommands: boolean;

  /**
   * Per-command substitutions keyed by pattern (prefix match).
   * When a tool calls sh() with a matching command, it is transparently
   * replaced with the substitute before execution.
   */
  commandSubstitutions?: Record<string, string>;

  /** Profile-derived threat classification (set by profiler, read by agent instructions builder) */
  threatLevel?: ThreatLevel;
}

let currentConfig: StealthConfig | null = null;

export function setStealthConfig(config: StealthConfig | null): void {
  currentConfig = config;
}

export function getStealthConfig(): StealthConfig | null {
  return currentConfig;
}

export function clearStealthConfig(): void {
  currentConfig = null;
}

export function isStealthEnabled(): boolean {
  return currentConfig?.enabled === true;
}

/**
 * Check if a command should be substituted with a quieter alternative.
 * Returns the replacement command if a pattern matches, or null to
 * execute the original command unchanged.
 */
export function getCommandSubstitution(command: string): string | null {
  const subs = currentConfig?.commandSubstitutions;
  if (!subs) return null;

  for (const [pattern, replacement] of Object.entries(subs)) {
    if (command.includes(pattern)) {
      return replacement;
    }
  }
  return null;
}

/**
 * Resolve after a random delay in the config's [minDelay, maxDelay] range.
 * Returns immediately when stealth is not enabled.
 */
export function stealthDelay(): Promise<void> {
  const cfg = currentConfig;
  if (!cfg?.enabled) return Promise.resolve();

  const delay = cfg.minDelay + Math.random() * (cfg.maxDelay - cfg.minDelay);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function getThreatLevel(): ThreatLevel | undefined {
  return currentConfig?.threatLevel;
}
