//go:build !windows

package module

import "fmt"

// RunBypassAmsi is a stub — AMSI patching is Windows-only.
func RunBypassAmsi(_ map[string]interface{}) (string, error) {
	return "", fmt.Errorf("AMSI bypass is Windows-only")
}

// RunBypassEtw is a stub — ETW patching is Windows-only.
func RunBypassEtw(_ map[string]interface{}) (string, error) {
	return "", fmt.Errorf("ETW bypass is Windows-only")
}

// RunBypassAll is a stub on non-Windows platforms.
func RunBypassAll(_ map[string]interface{}) (string, error) {
	return "", fmt.Errorf("bypass modules are Windows-only")
}
