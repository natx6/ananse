package module

import (
	"fmt"
	"strings"
)

// RunMonitorFIM checks critical files for unexpected changes.
func RunMonitorFIM(_ map[string]interface{}) (string, error) {
	cmd := "echo '---PASSWD---'; ls -la /etc/passwd /etc/master.passwd /etc/sudoers /etc/ssh/sshd_config 2>/dev/null; echo '---CRON---'; ls -laR /etc/cron* 2>/dev/null | head -30"
	return run(cmd)
}

// RunMonitorRootkit checks for common rootkit indicators.
func RunMonitorRootkit(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '---HIDDEN_PROC---'; ps aux 2>/dev/null | grep -E '\\[^\\]' | head -10",
		"echo '---MODULES---'; kextstat 2>/dev/null | grep -E 'hide|root|kit'",
		"echo '---NET---'; lsof -i -P -n 2>/dev/null | grep -E 'ESTABLISHED|LISTEN' | head -20",
		"echo '---SUID---'; find / -type f -perm -4000 2>/dev/null | head -20",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunMonitorAll runs all monitoring probes.
func RunMonitorAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"FIM", RunMonitorFIM},
		{"ROOTKIT", RunMonitorRootkit},
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
