import picocolors from "picocolors";
import type { StealthConfig, ThreatLevel } from "./stealth.js";
import type { SshSession } from "./transport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TargetProfile {
  osType: "linux" | "unknown";
  osDistro: string;
  kernelVersion: string;
  initSystem: "systemd" | "openrc" | "unknown";

  currentUser: string;
  isRoot: boolean;
  containerEnv: boolean;

  auditd: {
    present: boolean;
    active: boolean;
  };
  selinux: {
    present: boolean;
    mode: "enforcing" | "permissive" | "disabled" | "unknown";
  };
  apparmor: boolean;
  fail2ban: boolean;
  edrAgents: string[];
  sudoLogging: boolean;
  remoteLogging: boolean;

  threatLevel: ThreatLevel;
  profileConfidence: number;
}

// ---------------------------------------------------------------------------
// EDR/AV process signatures
// ---------------------------------------------------------------------------

const EDR_SIGNATURES: string[] = [
  "falcon-sensor",
  "falconctl",
  "crowdstrike",
  "osqueryd",
  "osqueryi",
  "osquery",
  "wazuh-agent",
  "wazuh",
  "ossec-agent",
  "ossec",
  "auditbeat",
  "filebeat",
  "packetbeat",
  "tripwire",
  "aide",
  "sentinelone",
  "sentinelctl",
  "sophos-agent",
  "sophos",
  "clamd",
  "freshclam",
  "rkhunter",
  "chkrootkit",
  "lynis",
  "scom-agent",
  "qualys",
  "tanium",
  "mcafee",
  "avast",
  "avg",
  "bitdefender",
  "kaspersky",
  "eset",
  "trendmicro",
  "carbonblack",
  "cbdefense",
];

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

async function exec(
  sshSession: SshSession,
  command: string,
): Promise<string> {
  try {
    const result = await sshSession.exec(command, 15_000);
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  } catch {
    return "";
  }
}

/** Run multiple commands in parallel and collect results. */
async function execAll(
  sshSession: SshSession,
  commands: string[],
): Promise<string[]> {
  return Promise.all(commands.map((cmd) => exec(sshSession, cmd)));
}

// ---------------------------------------------------------------------------
// Phase 1 — zero-risk probes (cat, test, ls on /proc, uname, whoami)
// ---------------------------------------------------------------------------

async function phase1(sshSession: SshSession): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  // Batch all Phase 1 probes in parallel (they are independent reads)
  const [initComm, osRelease, kernel, user, uid, auditdDir, selinuxCfg, aaProfiles, cgroup, processComms] =
    await execAll(sshSession, [
      "cat /proc/1/comm 2>/dev/null || echo unknown",
      "cat /etc/os-release 2>/dev/null | head -5 || cat /etc/*release 2>/dev/null | head -3 || echo unknown",
      "uname -r 2>/dev/null || echo unknown",
      "whoami 2>/dev/null || echo unknown",
      "id -u 2>/dev/null || echo unknown",
      "test -d /etc/audit && echo present || echo absent",
      "test -f /etc/selinux/config && echo present || echo absent",
      "ls /etc/apparmor.d 2>/dev/null | wc -l || echo 0",
      "cat /proc/1/cgroup 2>/dev/null | head -3 || echo unknown",
      "ls /proc/[0-9]*/comm 2>/dev/null | head -50 || echo ''",
    ]);

  results.initComm = initComm;
  results.osRelease = osRelease;
  results.kernel = kernel;
  results.user = user;
  results.uid = uid;
  results.auditdDir = auditdDir;
  results.selinuxCfg = selinuxCfg;
  results.aaProfiles = aaProfiles;
  results.cgroup = cgroup;
  results.processComms = processComms;

  return results;
}

// ---------------------------------------------------------------------------
// Phase 2 — low-risk probes (systemctl, getenforce, config greps)
// ---------------------------------------------------------------------------

async function phase2(sshSession: SshSession): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  const [auditdActive, selinuxMode, fail2banDir, listeningPorts, sudoLogFile, rsyslogCfg, auditdConf] =
    await execAll(sshSession, [
      "systemctl is-active auditd 2>/dev/null || echo inactive",
      "getenforce 2>/dev/null || echo not_found",
      "test -d /etc/fail2ban && echo present || echo absent",
      "ss -tuln 2>/dev/null | head -20 || echo ''",
      "ls /var/log/sudo.log 2>/dev/null || echo not_found",
      "cat /etc/rsyslog.conf 2>/dev/null | grep -E '@|##' | head -5 || echo not_found",
      "cat /etc/audit/auditd.conf 2>/dev/null | head -10 || echo not_found",
    ]);

  results.auditdActive = auditdActive;
  results.selinuxMode = selinuxMode;
  results.fail2banDir = fail2banDir;
  results.listeningPorts = listeningPorts;
  results.sudoLogFile = sudoLogFile;
  results.rsyslogCfg = rsyslogCfg;
  results.auditdConf = auditdConf;

  return results;
}

// ---------------------------------------------------------------------------
// Phase 3 — analysis (purely local)
// ---------------------------------------------------------------------------

function analyzeProfile(p1: Record<string, string>, p2: Record<string, string>): TargetProfile {
  // OS detection
  const osRelease = p1.osRelease ?? "";
  const osDistro = osRelease.includes("ID=")
    ? (osRelease.match(/^ID="?([^\s"]+)/m)?.[1] ?? osRelease.match(/ID=(\w+)/)?.[1] ?? "unknown")
    : "unknown";
  const kernelVersion = p1.kernel ?? "unknown";
  const initSystem = (p1.initComm ?? "").includes("systemd") ? "systemd" : "unknown";

  // User context
  const currentUser = p1.user ?? "unknown";
  const isRoot = p1.uid === "0";

  // Container detection
  const cgroup = p1.cgroup ?? "";
  const containerEnv = cgroup.includes("docker") || cgroup.includes("lxc") || cgroup.includes("kubepods");

  // Auditd
  const auditdPresent = p1.auditdDir === "present";
  const auditdActive = p2.auditdActive === "active";

  // SELinux
  const selinuxPresent = p1.selinuxCfg === "present";
  const selinuxModeRaw = p2.selinuxMode ?? "not_found";
  const selinuxMode =
    selinuxModeRaw === "Enforcing" ? "enforcing" :
    selinuxModeRaw === "Permissive" ? "permissive" :
    selinuxModeRaw === "Disabled" || selinuxModeRaw === "disabled" ? "disabled" :
    "unknown";

  // AppArmor
  const aaCount = parseInt(p1.aaProfiles ?? "0", 10);
  const apparmor = aaCount > 0;

  // Fail2ban
  const fail2ban = p2.fail2banDir === "present";

  // EDR detection — match process names against signatures
  const procComms = p1.processComms ?? "";
  const processNames = procComms
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  const edrAgents = EDR_SIGNATURES.filter((sig) =>
    processNames.some((name) => name.includes(sig)),
  );

  // Sudo logging
  const sudoLogging = (p2.sudoLogFile ?? "").includes("sudo.log");

  // Remote logging
  const rsyslogCfg = p2.rsyslogCfg ?? "";
  const remoteLogging = rsyslogCfg.includes("@") && !rsyslogCfg.includes("not_found");

  // Threat level derivation
  const threatLevel = deriveThreatLevel({
    edrAgents, auditdActive, auditdPresent, selinuxMode,
    sudoLogging, remoteLogging, fail2ban, apparmor,
  });

  // Confidence: both phases succeeded = high; Phase 2 partial = medium
  const p2HasData = p2.auditdActive !== undefined && p2.auditdActive !== "";
  const profileConfidence = p2HasData ? 0.9 : 0.6;

  return {
    osType: "linux",
    osDistro,
    kernelVersion,
    initSystem,
    currentUser,
    isRoot,
    containerEnv,
    auditd: { present: auditdPresent, active: auditdActive },
    selinux: { present: selinuxPresent, mode: selinuxMode },
    apparmor,
    fail2ban,
    edrAgents,
    sudoLogging,
    remoteLogging,
    threatLevel,
    profileConfidence,
  };
}

// ---------------------------------------------------------------------------
// Threat level derivation
// ---------------------------------------------------------------------------

function deriveThreatLevel(detections: {
  edrAgents: string[];
  auditdActive: boolean;
  auditdPresent: boolean;
  selinuxMode: string;
  sudoLogging: boolean;
  remoteLogging: boolean;
  fail2ban: boolean;
  apparmor: boolean;
}): ThreatLevel {
  if (detections.edrAgents.length > 0) return "high";
  if (detections.auditdActive) {
    // auditd active with logged commands is high-risk
    // We can't tell rule density without auditctl, so be conservative
    return "medium";
  }
  if (detections.selinuxMode === "enforcing") return "medium";
  if (detections.sudoLogging) return "medium";

  // Low-level defenses
  if (detections.auditdPresent) return "low";
  if (detections.fail2ban) return "low";
  if (detections.apparmor) return "low";
  if (detections.remoteLogging) return "low";

  return "clean";
}

// ---------------------------------------------------------------------------
// deriveStealthConfig — map profile to StealthConfig
// ---------------------------------------------------------------------------

export function deriveStealthConfig(profile: TargetProfile): StealthConfig {
  const subs: Record<string, string> = {};
  let minDelay: number;
  let maxDelay: number;
  let avoidHighRiskCommands: boolean;

  switch (profile.threatLevel) {
    case "high":
      minDelay = 12000;
      maxDelay = 35000;
      avoidHighRiskCommands = true;
      break;
    case "medium":
      minDelay = 7000;
      maxDelay = 20000;
      avoidHighRiskCommands = true;
      break;
    case "low":
      minDelay = 3000;
      maxDelay = 10000;
      avoidHighRiskCommands = true;
      break;
    case "clean":
    default:
      minDelay = 1000;
      maxDelay = 5000;
      avoidHighRiskCommands = false;
      break;
  }

  // Build command substitutions from profile
  if (profile.auditd.active || profile.auditd.present) {
    subs["auditctl -s"] = "echo '(auditd present — skipped)'";
    subs["auditctl -l"] = "echo '(auditd present — skipped)'";
  }
  if (profile.selinux.mode === "enforcing") {
    subs["chcon"] = "echo '(SELinux enforcing — skipped)'";
  }
  if (profile.threatLevel === "high" || profile.threatLevel === "medium") {
    subs["cat /etc/shadow"] = "test -f /etc/shadow && echo '(shadow read blocked — checking existence only)'";
    subs["sudo -l"] = "groups 2>/dev/null; echo '(sudo -l skipped)'";
    subs["find / -perm"] = "echo '(full FS scan blocked — using targeted check)'";
    subs["find / -writable"] = "echo '(full FS scan blocked — using targeted check)'";
  }

  return {
    enabled: true,
    minDelay,
    maxDelay,
    avoidHighRiskCommands,
    commandSubstitutions: Object.keys(subs).length > 0 ? subs : undefined,
    threatLevel: profile.threatLevel,
  };
}

// ---------------------------------------------------------------------------
// buildProfileContext — structured block for agent instructions
// ---------------------------------------------------------------------------

export function buildProfileContext(profile: TargetProfile): string {
  const defenses: string[] = [];
  if (profile.auditd.active) defenses.push("auditd: active");
  else if (profile.auditd.present) defenses.push("auditd: present (inactive)");
  if (profile.selinux.mode === "enforcing") defenses.push("SELinux: enforcing");
  else if (profile.selinux.present) defenses.push(`SELinux: ${profile.selinux.mode}`);
  if (profile.apparmor) defenses.push("AppArmor: active");
  if (profile.fail2ban) defenses.push("fail2ban: present");
  if (profile.sudoLogging) defenses.push("sudo: logging active");
  if (profile.remoteLogging) defenses.push("logs: forwarded off-host");
  if (profile.edrAgents.length > 0) defenses.push(`EDR: ${profile.edrAgents.join(", ")}`);

  const riskCommands: string[] = [];
  if (profile.auditd.active || profile.auditd.present) riskCommands.push("auditctl");
  if (profile.selinux.mode === "enforcing") riskCommands.push("chcon");
  if (profile.threatLevel === "high" || profile.threatLevel === "medium") {
    riskCommands.push("sudo -l", "full filesystem scans");
  }

  const okCommands = [
    "ps (without aux)",
    "ss (without -p)",
    "systemctl",
    "cat /proc/*",
    "test / ls",
  ];

  return [
    `<TARGET_PROFILE>`,
    `OS: ${profile.osDistro} (kernel ${profile.kernelVersion})`,
    `User: ${profile.currentUser}${profile.isRoot ? " (root)" : ""}`,
    `Container: ${profile.containerEnv ? "yes" : "no"}`,
    `Threat Level: ${profile.threatLevel.toUpperCase()}`,
    ``,
    `Active Defenses:`,
    ...(defenses.length > 0 ? defenses.map((d) => `  - ${d}`) : ["  (none detected)"]),
    ...(profile.edrAgents.length > 0
      ? [``, `Detected EDR Agents:`, ...profile.edrAgents.map((a) => `  - ${a}`)]
      : []),
    ``,
    `STEALTH RECOMMENDATIONS:`,
    `  - Delays randomized between ${Math.round(deriveStealthConfig(profile).minDelay / 1000)}-${Math.round(deriveStealthConfig(profile).maxDelay / 1000)}s`,
    ...(riskCommands.length > 0
      ? [`  - Avoid: ${riskCommands.join(", ")}`]
      : []),
    `  - OK to use: ${okCommands.join(", ")}`,
    `</TARGET_PROFILE>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// runProfiler — orchestrate all three phases
// ---------------------------------------------------------------------------

export interface ProfileResult {
  profile: TargetProfile | null;
  adaptedConfig: StealthConfig | null;
  contextBlock: string | null;
}

export async function runProfiler(sshSession: SshSession): Promise<ProfileResult> {
  process.stdout.write(picocolors.cyan("  Profiling target defenses...\n"));

  // Phase 1
  process.stdout.write(picocolors.dim("    phase 1: environment "));
  let p1: Record<string, string>;
  try {
    p1 = await phase1(sshSession);
    process.stdout.write(picocolors.green("✓\n"));
  } catch (err) {
    process.stdout.write(picocolors.red("✗\n"));
    console.warn(picocolors.yellow(`  Warning: profiling failed: ${(err as Error).message}`));
    return { profile: null, adaptedConfig: null, contextBlock: null };
  }

  // Phase 2
  process.stdout.write(picocolors.dim("    phase 2: defenses "));
  let p2: Record<string, string>;
  try {
    p2 = await phase2(sshSession);
    process.stdout.write(picocolors.green("✓\n"));
  } catch {
    // Phase 2 failure is non-fatal — proceed with partial data
    p2 = {};
    process.stdout.write(picocolors.yellow("~ (partial)\n"));
  }

  // Phase 3
  process.stdout.write(picocolors.dim("    phase 3: assessment "));
  const profile = analyzeProfile(p1, p2);
  process.stdout.write(picocolors.green("✓\n"));

  // Build output
  const adaptedConfig = deriveStealthConfig(profile);
  const contextBlock = buildProfileContext(profile);

  // Print summary
  const edrLabel = profile.edrAgents.length > 0
    ? picocolors.red(profile.edrAgents.join(", "))
    : picocolors.green("none detected");
  const delayLabel = `${picocolored(String(Math.round(adaptedConfig.minDelay / 1000)))}-${picocolored(String(Math.round(adaptedConfig.maxDelay / 1000)))}s`;

  process.stdout.write(
    `  Target: ${picocolored(profile.osDistro)} ${picocolors.dim(profile.kernelVersion)}` +
    ` | User: ${picocolored(profile.currentUser)}` +
    `${profile.isRoot ? picocolors.red(" (root)") : ""}\n`,
  );

  const defParts: string[] = [];
  if (profile.auditd.active) defParts.push(picocolors.yellow("auditd(active)"));
  else if (profile.auditd.present) defParts.push("auditd(inactive)");
  if (profile.selinux.mode === "enforcing") defParts.push(picocolors.yellow("selinux(enforcing)"));
  if (profile.edrAgents.length > 0) defParts.push(picocolors.red(`edr:${profile.edrAgents[0]}`));
  process.stdout.write(`  Defenses: ${defParts.length > 0 ? defParts.join(", ") : picocolors.green("none")}\n`);
  process.stdout.write(`  EDR: ${edrLabel}\n`);
  process.stdout.write(
    `  Threat Level: ${formatThreatLevel(profile.threatLevel)}` +
    ` | Delays: ${delayLabel}` +
    ` | Confidence: ${(profile.profileConfidence * 100).toFixed(0)}%\n`,
  );

  return { profile, adaptedConfig, contextBlock };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function picocolored(s: string): string {
  return picocolors.white(s);
}

function formatThreatLevel(level: ThreatLevel): string {
  switch (level) {
    case "high": return picocolors.red("HIGH");
    case "medium": return picocolors.yellow("MEDIUM");
    case "low": return picocolors.blue("LOW");
    case "clean": return picocolors.green("CLEAN");
  }
}
