package module

import (
	"fmt"
	"strings"
)

// RunPersistenceSSH inspects SSH keys and configuration.
func RunPersistenceSSH(_ map[string]interface{}) (string, error) {
	cmd := `powershell -Command "Get-ChildItem $env:USERPROFILE\.ssh -ErrorAction SilentlyContinue | Format-Table Name,Length,LastWriteTime; echo '---AUTHORIZED---'; Get-Content $env:USERPROFILE\.ssh\authorized_keys -ErrorAction SilentlyContinue"`
	return run(cmd)
}

// RunPersistenceStartup checks startup programs and services.
func RunPersistenceStartup(_ map[string]interface{}) (string, error) {
	cmds := []string{
		`powershell -Command "Get-CimInstance Win32_StartupCommand | Format-Table Name,Command,Location -AutoSize"`,
		`echo '---SERVICES---'; powershell -Command "Get-Service | Where-Object StartType -eq Auto | Format-Table Name,Status -AutoSize"`,
		`echo '---REG_RUN---'; powershell -Command "Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue | Format-Table -AutoSize"`,
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
