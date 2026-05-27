package executor

import (
	"time"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

// RunShell executes a shell command with a timeout (delegates to shell package).
func RunShell(command string, timeout time.Duration) (string, error) {
	return shell.Run(command, timeout)
}
