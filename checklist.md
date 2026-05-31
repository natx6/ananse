# Ananse — Feature & Test Checklist

## Core
- [ ] **Auto-intro** — First message of fresh session shows full name + abbreviation + mode
- [ ] **Mode switch** — Type `offense`/`defense`/`normal`, see banner + clearance info
- [ ] **abilities** — Lists actual tool names by category
- [ ] **/help** — Shows profile, mission, SSH, C2 tools
- [ ] **Session resume** — Pick session, see history replayed, missions carry over
- [ ] **Up arrow** — Cycles through command history

## Path Resolution
- [ ] **Wrong path** — `documents/file` auto-resolves to `~/Documents/file`
- [ ] **Search with wrong path** — Returns resolved path instead of "not found"

## SSH-in-REPL
- [ ] **ssh_connect** — Connects to remote host, commands run remotely
- [ ] **ssh_disconnect** — Restores local execution
- [ ] **ssh_status** — Shows target + uptime

## Missions
- [ ] **mission_set** — Creates goal with tracked steps
- [ ] **Autonomous progress** — AI drives toward mission without prompting
- [ ] **mission_status** — Shows progress
- [ ] **Fresh sessions** — Old missions don't leak in

## Persistent Memory
- [ ] **Knowledge base** — Sessions auto-ingested into searchable knowledge
- [ ] **remember tool** — Can search past sessions

## C2
- [ ] **c2-server** — Starts on port, shows reach/beacon/stager endpoints
- [ ] **c2_deploy** — Builds + deploys implant via SSH
- [ ] **gather_all** — Runs all recon + credential + collect modules at once
- [ ] **Per-binary uniqueness** — Each build produces unique binary
- [ ] **DNS transport** — Implant can beacon over DNS TXT queries

## Analysis
- [ ] **analyze** — Tells you language, framework, deps, structure of any dir
- [ ] **scan_secrets** — Accepts path, scans that directory only
- [ ] **scan_owasp** — Accepts path, ignores node_modules

## Auto-Intrusion
- [ ] **auto_chain** — Scans subnet → finds services → brute creds → reports access
- [ ] **Stealth mode** — Random delays, jitter between probes

## Safety
- [ ] **No delete without confirm** — AI refuses to delete files without OK
- [ ] **No sudo** — AI refuses interactive commands
- [ ] **Error handling** — Clean messages, no stack traces

## Profile
- [ ] **profile_set** — Save preferences, projects, working style
- [ ] **profile_get** — View saved profile

## Sub-Agent
- [ ] **subagent** — Spawns focused AI with limited tools
- [ ] **Working directory** — Sub-agents know project root

## Not Built Yet
- [ ] **Interactive C2 sessions** — Bidirectional shell on implant
- [ ] **BOF plugin system** — Load compiled .o files in-memory
- [ ] **Syscall execution** — HellHall-style direct syscalls
- [ ] **Multi-node orchestration** — Commander controls remote ananse instances
