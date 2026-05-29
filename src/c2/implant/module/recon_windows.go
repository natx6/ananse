package module

import (
	"fmt"
	"strings"
)

// RunReconProcesses lists running processes via PowerShell.
func RunReconProcesses(_ map[string]interface{}) (string, error) {
	return run(`powershell -Command "Get-Process | Format-Table -AutoSize Name,Id,CPU,PM"`)
}

// RunReconNetwork lists listening ports and connections.
func RunReconNetwork(_ map[string]interface{}) (string, error) {
	cmds := []string{
		`powershell -Command "Get-NetTCPConnection -State Listen | Format-Table -AutoSize LocalAddress,LocalPort,State"`,
		`powershell -Command "Get-NetUDPEndpoint | Format-Table -AutoSize LocalAddress,LocalPort"`,
		`netstat -ano`,
	}
	return run(strings.Join(cmds, "; echo '---'; "))
}

// RunReconUsers lists local users and active sessions.
func RunReconUsers(_ map[string]interface{}) (string, error) {
	cmd := `powershell -Command "Get-LocalUser | Format-Table Name,Enabled,LastLogon; echo '---LOGIN---'; query user 2>nul || echo 'query user not available'"`
	return run(cmd)
}

// RunReconCron inspects scheduled tasks.
func RunReconCron(_ map[string]interface{}) (string, error) {
	cmd := `powershell -Command "Get-ScheduledTask | Where-Object State -ne Disabled | Format-Table TaskName,State,TaskPath -AutoSize"`
	return run(cmd)
}

// RunReconSuid checks for weak service ACLs (Windows equivalent of SUID).
func RunReconSuid(_ map[string]interface{}) (string, error) {
	cmd := `powershell -Command "Get-WmiObject -Class Win32_Service | Where-Object { $_.StartName -eq 'LocalSystem' } | Select-Object Name,State,PathName | Format-Table -AutoSize"`
	return run(cmd)
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
		{"SCHTASKS", RunReconCron},
		{"SERVICES", RunReconSuid},
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
