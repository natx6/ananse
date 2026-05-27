import picocolors from "picocolors";

export type AnanseMode = "normal" | "offense" | "defense";

export interface ToolRegistration {
  name: string;
  mode: "core" | "offense" | "defense";
}

const toolRegistry: ToolRegistration[] = [];

export function registerTool(name: string, mode: "core" | "offense" | "defense"): void {
  const existing = toolRegistry.findIndex((t) => t.name === name);
  if (existing !== -1) {
    toolRegistry[existing].mode = mode;
    return;
  }
  toolRegistry.push({ name, mode });
}

export function getToolMode(name: string): "core" | "offense" | "defense" | null {
  return toolRegistry.find((t) => t.name === name)?.mode ?? null;
}

export function getModeFromConfig(config: Record<string, string | undefined>): AnanseMode {
  const mode = config.mode ?? "normal";
  if (mode === "offense") return "offense";
  if (mode === "defense") return "defense";
  return "normal";
}

export function getToolNamesForMode(mode: AnanseMode): string[] {
  if (mode === "normal") {
    return toolRegistry.map((t) => t.name);
  }
  return toolRegistry
    .filter((t) => t.mode === "core" || t.mode === mode)
    .map((t) => t.name);
}

export function filterToolsByMode<T extends Record<string, unknown>>(
  tools: T,
  mode: AnanseMode,
): Partial<T> {
  if (mode === "normal") return tools;
  const allowed = new Set(
    toolRegistry
      .filter((t) => t.mode === "core" || t.mode === mode)
      .map((t) => t.name),
  );
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(tools)) {
    if (allowed.has(key)) {
      filtered[key] = tools[key];
    }
  }
  return filtered as Partial<T>;
}

export function listRegisteredTools(): ToolRegistration[] {
  return [...toolRegistry];
}

// ---------------------------------------------------------------------------
// Mode info display
// ---------------------------------------------------------------------------

const modeInfo: Record<AnanseMode, { title: string; description: string; useCases: string[]; tools: string }> = {
  normal: {
    title: "CLEARANCE LEVEL: UNCLASSIFIED",
    description: "General-purpose operations. COMSEC-safe mode for routine engineering, analysis, and automation tasks. All tools available — no classified capabilities exposed.",
    useCases: [
      "Software engineering and code analysis",
      "Intelligence preparation of the battlespace (due diligence)",
      "System administration and signal search",
      "Data processing and pattern analysis",
    ],
    tools: "Full toolchain — no restrictions",
  },
  offense: {
    title: "CLEARANCE LEVEL: TAO//ECI",
    description: "Offensive cyber operations — Tailored Access Operations directive. Enables full-spectrum exploitation, persistence, and lateral movement capabilities per TAO engagement authority.",
    useCases: [
      "Network survey and battlespace mapping (CNE)",
      "Vulnerability exploitation and access expansion (CNA)",
      "Privilege escalation — vertical and horizontal movement",
      "Implant deployment and persistence mechanisms",
      "Data exfiltration via covert channels",
    ],
    tools: "Core + TAO toolkit: scan, probe, exploit, pivot, exfiltrate, implant",
  },
  defense: {
    title: "CLEARANCE LEVEL: FORNSAT//SI",
    description: "Defensive countermeasures — Signals Intelligence directorate. Continuous monitoring, threat hunting, and battlespace hardening per SIGINT operational security directives.",
    useCases: [
      "Continuous battlespace monitoring (Guard — persistent sensor loop)",
      "File integrity monitoring and drift detection (FIM)",
      "Stealth profiling — EDR/AV evasion assessment",
      "Hardening per CIS/STIG compliance frameworks",
      "Incident response — forensic collection and analysis",
    ],
    tools: "Core + SIGINT suite: guard, monitor, harden, audit, profile, sentry",
  },
};

export function printModeInfo(mode: AnanseMode): void {
  const info = modeInfo[mode];
  console.log("");
  console.log(`  ${picocolors.bold(info.title)}`);
  console.log(`  ${picocolors.dim("─".repeat(50))}`);
  console.log(`  ${info.description}`);
  console.log("");
  console.log(`  ${picocolors.cyan("Use cases:")}`);
  for (const uc of info.useCases) {
    console.log(`    ${picocolors.green("▸")} ${uc}`);
  }
  console.log("");
  console.log(`  ${picocolors.dim(`Tools: ${info.tools}`)}`);
  console.log("");
}
