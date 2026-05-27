package module

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Persistence checks
// ---------------------------------------------------------------------------

// RunPersistenceSSH inspects SSH keys and authorized_keys.
func RunPersistenceSSH(_ map[string]interface{}) (string, error) {
	cmd := "ls -la ~/.ssh/ 2>/dev/null; echo '---AUTHORIZED---'; cat ~/.ssh/authorized_keys 2>/dev/null; echo '---SSHD_CONFIG---'; cat /etc/ssh/sshd_config 2>/dev/null | grep -v '^#' | grep -v '^$' | head -30"
	return run(cmd)
}

// RunPersistenceStartup checks boot and service persistence points.
func RunPersistenceStartup(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"ls -la /etc/rc*.d/ 2>/dev/null | head -40",
		"echo '---SYSTEMD---'; systemctl list-unit-files --type=service 2>/dev/null | head -40",
		"echo '---INITD---'; ls -la /etc/init.d/ 2>/dev/null | head -20",
		"echo '---MODULES---'; lsmod 2>/dev/null | head -30",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPersistenceAll runs all persistence checks.
func RunPersistenceAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"SSH", RunPersistenceSSH},
		{"STARTUP", RunPersistenceStartup},
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
