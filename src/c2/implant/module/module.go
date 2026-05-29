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

// commonPasswords used by brute force modules across all platforms.
var commonPasswords = []string{
	"password", "admin", "root", "123456", "12345678",
	"qwerty", "letmein", "welcome", "Passw0rd!", "toor",
	"test", "1234", "12345", "123456789", "1234567890",
	"passwd", "iloveyou", "abc123", "password123", "P@ssw0rd",
}
