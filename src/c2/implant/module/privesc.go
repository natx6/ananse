package module

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Privilege escalation checks
// ---------------------------------------------------------------------------

// RunPrivescSudo checks sudo privileges and version.
func RunPrivescSudo(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"sudo -V 2>/dev/null | head -1",
		"sudo -l -n 2>/dev/null || echo 'sudo -l requires password'",
		"echo '---GROUPS---'; id; groups",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescWritable checks for world-writable sensitive files and PATH hijack.
func RunPrivescWritable(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"find /etc -writable -type f 2>/dev/null | head -30",
		"echo '---SHADOW---'; ls -la /etc/shadow /etc/passwd /etc/sudoers 2>/dev/null",
		"echo '---PATH---'; IFS=':'; for d in $PATH; do ls -la \"$d\" 2>/dev/null | grep -v '^total'; done",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescKernel checks kernel version and known exploit vectors.
func RunPrivescKernel(_ map[string]interface{}) (string, error) {
	out, err := run("uname -a 2>/dev/null; echo '---RELEASE---'; cat /etc/os-release 2>/dev/null | head -10")
	if err != nil {
		return out, err
	}

	// Simple kernel version check for known old/vulnerable kernels
	kernelOut, _ := run("uname -r 2>/dev/null")
	kernelVer := strings.TrimSpace(kernelOut)
	var hints []string
	if strings.Contains(kernelVer, "2.6.") || strings.Contains(kernelVer, "3.") || strings.Contains(kernelVer, "4.") {
		hints = append(hints, fmt.Sprintf("older kernel (%s) — possible kernel exploit", kernelVer))
	}
	if strings.Contains(kernelVer, "el6") || strings.Contains(kernelVer, "el7") {
		hints = append(hints, "RHEL/CentOS 6/7 — check for dirtypipe, dirtycow, etc.")
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
		{"SUDO", RunPrivescSudo},
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
