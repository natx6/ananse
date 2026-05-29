package module

import (
	"fmt"
	"strings"
)

// RunReconProcesses lists running processes.
func RunReconProcesses(_ map[string]interface{}) (string, error) {
	return run("ps aux 2>/dev/null")
}

// RunReconNetwork lists listening ports and active connections.
func RunReconNetwork(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"lsof -i -P -n 2>/dev/null | head -60",
		"netstat -an 2>/dev/null | grep LISTEN",
	}
	return run(strings.Join(cmds, "; echo '---'; "))
}

// RunReconUsers lists user accounts and active sessions.
func RunReconUsers(_ map[string]interface{}) (string, error) {
	cmd := "dscl . list /Users 2>/dev/null | grep -v '^_' | head -40; echo '---LOGIN---'; w 2>/dev/null; echo '---LAST---'; last -20 2>/dev/null"
	return run(cmd)
}

// RunReconCron inspects scheduled jobs.
func RunReconCron(_ map[string]interface{}) (string, error) {
	cmd := "ls -la /etc/cron* /usr/lib/cron/tabs/ 2>/dev/null; echo '---CRONTAB---'; crontab -l 2>/dev/null; echo '---LAUNCHD---'; ls -la /Library/LaunchDaemons/ /Library/LaunchAgents/ 2>/dev/null | head -40"
	return run(cmd)
}

// RunReconSuid finds SUID/SGID binaries.
func RunReconSuid(_ map[string]interface{}) (string, error) {
	return run("find /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin -type f \\( -perm -4000 -o -perm -2000 \\) 2>/dev/null")
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
