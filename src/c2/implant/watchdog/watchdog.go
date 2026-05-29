package watchdog

import (
	"os"
)

// Install tries to establish persistence using platform mechanisms.
func Install(implantPath string) error {
	return installImpl(implantPath)
}

// Remove removes any persistence mechanisms.
func Remove() error {
	return removeImpl()
}

// IsPersistent checks if persistence is active.
func IsPersistent() bool {
	return isPersistentImpl()
}

func selfPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "/proc/self/exe"
	}
	return exe
}
