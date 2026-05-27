package stealth

import (
	"encoding/base64"
	"fmt"
	"math/rand"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

// Sleep sleeps for the given duration.
func Sleep(d time.Duration) {
	if d > 0 {
		time.Sleep(d)
	}
}

// Jitter returns a random duration with ±pct percent jitter around base.
func Jitter(base time.Duration, pct int) time.Duration {
	if pct <= 0 {
		pct = 30
	}
	jitter := base * time.Duration(int64(float64(base.Nanoseconds())*float64(pct)/100.0*float64(rand.Intn(200)-100)/100.0))
	return base + jitter
}

// SleepJitter sleeps for base duration with ±pct percent jitter.
func SleepJitter(base time.Duration, pct int) {
	Sleep(Jitter(base, pct))
}

// FailDelay returns an exponential backoff duration, capped at cap.
func FailDelay(attempt int, base, cap time.Duration) time.Duration {
	delay := base * (1 << min(attempt, 30))
	if delay > cap {
		delay = cap
	}
	return Jitter(delay, 20)
}

// ---------------------------------------------------------------------------
// Command obfuscation
// ---------------------------------------------------------------------------

// ObfuscateCmd wraps a shell command in obfuscation to evade simple
// pattern-matching detection. Methods are chosen randomly:
//
//   - base64:  echo <b64> | base64 -d | sh
//   - split:   inserts random escaped newlines and whitespace
//   - comment: inserts benign echo with random string
//   - none:    return as-is (1 in 4 chance to blend in)
func ObfuscateCmd(cmd string) string {
	// 25% chance — pass through (looks like normal activity)
	if rand.Intn(4) == 0 {
		return cmd
	}

	method := rand.Intn(3)
	switch method {
	case 0: // base64 wrap
		b64 := base64.StdEncoding.EncodeToString([]byte(cmd))
		return fmt.Sprintf("echo %s | base64 -d | sh", b64)

	case 1: // random whitespace + line continuation
		var parts []string
		for _, word := range strings.Fields(cmd) {
			if rand.Intn(5) == 0 {
				parts = append(parts, word)
			} else {
				parts = append(parts, word)
			}
		}
		// Insert random line continuation every 2-4 words
		var result []string
		for i, p := range parts {
			result = append(result, p)
			if i > 0 && i < len(parts)-1 && i%2 == 0 && rand.Intn(2) == 0 {
				result = append(result, "\\\n")
			}
		}
		return strings.Join(result, " ")

	case 2: // benign echo prefix (noise)
		noise := fmt.Sprintf("echo \"check-%d\" >/dev/null", rand.Intn(99999))
		return fmt.Sprintf("%s; %s", noise, cmd)
	}

	return cmd
}

// DelayBeforeOp returns a recommended delay before executing an operation,
// scaled by threat level. Empty string = low, "low"/"medium"/"high"/"critical".
func DelayBeforeOp(threatLevel string) time.Duration {
	switch threatLevel {
	case "critical":
		return Jitter(3*time.Second, 50) // 1.5-4.5s
	case "high":
		return Jitter(2*time.Second, 50)
	case "medium":
		return Jitter(1*time.Second, 50)
	default:
		return Jitter(200*time.Millisecond, 100)
	}
}

// WaitBetweenOps returns a delay to insert between sequential operations.
func WaitBetweenOps(threatLevel string) time.Duration {
	switch threatLevel {
	case "critical":
		return Jitter(10*time.Second, 40)
	case "high":
		return Jitter(5*time.Second, 40)
	case "medium":
		return Jitter(2*time.Second, 50)
	default:
		return Jitter(500*time.Millisecond, 60)
	}
}

// ---------------------------------------------------------------------------
// Random utilities
// ---------------------------------------------------------------------------

// RandSleep sleeps for a random duration between min and max.
func RandSleep(min, max time.Duration) {
	if max <= min {
		Sleep(min)
		return
	}
	d := min + time.Duration(rand.Int63n(int64(max-min)))
	Sleep(d)
}
