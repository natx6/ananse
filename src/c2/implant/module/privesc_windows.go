package module

import (
	"fmt"
	"strings"
)

// RunPrivescSudo checks token privileges and admin status.
func RunPrivescSudo(_ map[string]interface{}) (string, error) {
	cmds := []string{
		`powershell -Command "whoami /all"`,
		`powershell -Command "net session 2>nul && echo 'Administrator' || echo 'Not admin'"`,
		`echo '---GROUPS---'; whoami /groups`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescWritable checks for writable sensitive paths (icacls).
func RunPrivescWritable(_ map[string]interface{}) (string, error) {
	cmds := []string{
		`powershell -Command "Get-WmiObject -Class Win32_Service | Where-Object { (Get-Acl $_.PathName -ErrorAction SilentlyContinue).Access -match 'Everyone' } | Select-Object Name,PathName | Format-Table -AutoSize"`,
		`echo '---PATH---'; echo %PATH%`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescKernel checks OS version and known exploit indicators.
func RunPrivescKernel(_ map[string]interface{}) (string, error) {
	out, err := run(`powershell -Command "systeminfo | findstr /B /C:'OS Name' /C:'OS Version' /C:'System Type'"`)
	if err != nil {
		return out, err
	}
	kernelOut, _ := run(`powershell -Command "(Get-WmiObject Win32_OperatingSystem).Version"`)
	kernelVer := strings.TrimSpace(kernelOut)
	var hints []string
	if strings.HasPrefix(kernelVer, "10.0.1") || strings.HasPrefix(kernelVer, "6.3") || strings.HasPrefix(kernelVer, "6.2") {
		hints = append(hints, fmt.Sprintf("older Windows (%s) — possible exploit", kernelVer))
	}
	if len(hints) > 0 {
		out += "\n\n--- HINTS ---\n" + strings.Join(hints, "\n")
	}
	return out, nil
}

// RunPrivescAll runs all privesc checks.
func RunPrivescAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"PRIVILEGES", RunPrivescSudo},
		{"WRITABLE", RunPrivescWritable},
		{"KERNEL", RunPrivescKernel},
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
