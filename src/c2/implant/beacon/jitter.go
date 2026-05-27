package beacon

import (
	"math/rand"
	"time"
)

// NextInterval returns the beacon interval with ±30% jitter applied.
func NextInterval(baseMs int64) time.Duration {
	if baseMs <= 0 {
		baseMs = 60000
	}
	jitter := float64(baseMs) * (0.3 * float64(rand.Intn(200)-100) / 100.0)
	return time.Duration(baseMs+int64(jitter)) * time.Millisecond
}
