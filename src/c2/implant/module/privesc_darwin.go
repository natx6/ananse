package module

import (
	"fmt"
	"strings"
)

// RunPrivescSudo checks sudo privileges and version.
func RunPrivescSudo(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"sudo -V 2>/dev/null | head -1",
		"sudo -l -n 2>/dev/null || echo 'sudo -l requires password'",
		"echo '---GROUPS---'; id; groups",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescWritable checks for world-writable sensitive files.
func RunPrivescWritable(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"find /etc -writable -type f 2>/dev/null | head -30",
		"echo '---SHADOW---'; ls -la /etc/shadow /etc/passwd /etc/sudoers 2>/dev/null || ls -la /etc/master.passwd 2>/dev/null",
		"echo '---PATH---'; IFS=':'; for d in $PATH; do ls -la \"$d\" 2>/dev/null | grep -v '^total'; done",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunPrivescKernel checks kernel version and known exploit vectors.
func RunPrivescKernel(_ map[string]interface{}) (string, error) {
	out, err := run("uname -a 2>/dev/null; echo '---VERSION---'; sw_vers 2>/dev/null")
	if err != nil {
		return out, err
	}
	kernelOut, _ := run("uname -r 2>/dev/null")
	kernelVer := strings.TrimSpace(kernelOut)
	var hints []string
	if strings.HasPrefix(kernelVer, "1") || strings.HasPrefix(kernelVer, "2") || strings.HasPrefix(kernelVer, "3") {
		hints = append(hints, fmt.Sprintf("older macOS kernel (%s) — possible exploit", kernelVer))
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
