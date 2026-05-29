package module

import (
	"fmt"
	"strings"
)

// RunMonitorFIM checks critical files for changes.
func RunMonitorFIM(_ map[string]interface{}) (string, error) {
	cmd := `powershell -Command "Get-ChildItem $env:SystemRoot\system32\drivers\etc\hosts, $env:SystemRoot\System32\config\SAM -ErrorAction SilentlyContinue | Format-Table Name,Length,LastWriteTime -AutoSize"`
	return run(cmd)
}

// RunMonitorRootkit checks for common rootkit indicators on Windows.
func RunMonitorRootkit(_ map[string]interface{}) (string, error) {
	cmds := []string{
		`echo '---HIDDEN_PROC---'; powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -eq '' -and $_.Name -notmatch 'System|Idle|smss|csrss|wininit|services|lsass' } | Format-Table Name,Id,CPU -AutoSize"`,
		`echo '---NET---'; netstat -ano | findstr ESTABLISHED`,
		`echo '---SUSPICIOUS---'; powershell -Command "Get-Service | Where-Object { $_.Status -eq 'Running' -and $_.StartType -eq 'Auto' -and $_.Name -notmatch '^win|^Wdi|^Wep|^wlms|^wmi' } | Format-Table Name,DisplayName -AutoSize"`,
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
