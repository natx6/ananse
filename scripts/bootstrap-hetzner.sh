#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# ananse — Hetzner VPS bootstrap
# ─────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/bootstrap-hetzner.sh root@<hetzner-ip>
#
# This script installs everything needed to run ananse on
# a fresh Hetzner VPS (Ubuntu 22.04/24.04), including:
#   - Node.js, Go, git, tmux
#   - ananse (cloned from GitHub)
#   - C2 server systemd service (optional)
#   - tmux session management
# ─────────────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
  echo "Usage: $0 root@<hetzner-ip> [--with-c2]"
  echo ""
  echo "  --with-c2    Also set up systemd service for C2 server"
  echo ""
  exit 1
fi

TARGET="$1"
SETUP_C2=false
for arg in "$@"; do
  [ "$arg" = "--with-c2" ] && SETUP_C2=true
done

REMOTE_DIR="/root/ananse"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ananse — Hetzner Bootstrap"
echo "  Target: $TARGET"
echo "  C2 server: $([ "$SETUP_C2" = true ] && echo 'yes' || echo 'no')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Install system dependencies ────────────────────
echo "  >> Installing system dependencies..."
ssh "$TARGET" bash -s << 'REMOTE'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git tmux nodejs npm golang-go ufw unattended-upgrades 2>/dev/null | tail -1
  echo "  ✓ System dependencies installed"

  # Enable automatic security updates
  dpkg-reconfigure -f noninteractive unattended-upgrades 2>/dev/null || true

  # Install latest Node.js if the distro version is too old
  NODE_VER=$(node --version 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo "0")
  if [ "$NODE_VER" -lt 20 ]; then
    echo "  >> Installing Node.js 20+..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null | tail -1
    apt-get install -y -qq nodejs 2>/dev/null | tail -1
  fi
  echo "  ✓ Node.js $(node --version)"
  echo "  ✓ Go $(go version | grep -oP 'go\d+\.\d+')"
  echo "  ✓ tmux $(tmux -V | grep -oP '\d+\.\d+')"
REMOTE

# ── Step 2: Clone & build ananse ───────────────────────────
echo "  >> Cloning ananse..."
ssh "$TARGET" "git clone https://github.com/natx6/ananse.git $REMOTE_DIR 2>/dev/null || (cd $REMOTE_DIR && git pull)" | tail -1

echo "  >> Building ananse..."
ssh "$TARGET" "cd $REMOTE_DIR && npm install --silent && npx tsc 2>&1" | tail -1
echo "  ✓ Build complete"

# ── Step 3: Link ananse globally ───────────────────────────
ssh "$TARGET" "npm link --silent --prefix $REMOTE_DIR 2>/dev/null" || true
echo "  ✓ ananse linked globally"

# ── Step 4: Create tmux session launcher ───────────────────
echo "  >> Creating tmux launcher script..."
ssh "$TARGET" "cat > /root/start-ananse.sh" << 'SCRIPT'
#!/usr/bin/env bash
# Start or attach to ananse tmux session
SESSION="ananse"
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing session..."
  tmux attach-session -t "$SESSION"
else
  echo "Starting new session..."
  tmux new-session -d -s "$SESSION" -c /root/ananse 'bash -c "cd /root/ananse && node dist/index.js"'
  tmux set-option -t "$SESSION" status-left "[ananse]"
  tmux attach-session -t "$SESSION"
fi
SCRIPT
chmod +x /root/start-ananse.sh
echo "  ✓ Launcher script created: /root/start-ananse.sh"

# ── Step 5: C2 systemd service (optional) ──────────────────
if [ "$SETUP_C2" = true ]; then
  echo "  >> Setting up C2 server systemd service..."
  ssh "$TARGET" "cat > /etc/systemd/system/ananse-c2.service" << 'SERVICE'
[Unit]
Description=ananse C2 Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/ananse
Environment=C2_API_KEY=op-key-change-me
Environment=C2_IMPLANT_TOKEN=imp-token-change-me
Environment=C2_STAGER_TOKEN=stag3r-t0k3n-change
Environment=C2_IMPLANT_PATH=/tmp/implant
ExecStart=/usr/bin/node dist/c2/server/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

  ssh "$TARGET" "cat > /root/set-c2-tokens.sh" << 'TOKENS'
#!/usr/bin/env bash
# Set C2 tokens — run this before starting the server
echo "Set your C2 tokens. Leave blank for defaults."
read -p "C2_API_KEY [op-key-change-me]: " api_key
read -p "C2_IMPLANT_TOKEN [imp-token-change-me]: " imp_token
read -p "C2_STAGER_TOKEN [stag3r-t0k3n-change]: " stager_token

sed -i "s/Environment=C2_API_KEY=.*/Environment=C2_API_KEY=${api_key:-op-key-change-me}/" /etc/systemd/system/ananse-c2.service
sed -i "s/Environment=C2_IMPLANT_TOKEN=.*/Environment=C2_IMPLANT_TOKEN=${imp_token:-imp-token-change-me}/" /etc/systemd/system/ananse-c2.service
sed -i "s/Environment=C2_STAGER_TOKEN=.*/Environment=C2_STAGER_TOKEN=${stager_token:-stag3r-t0k3n-change}/" /etc/systemd/system/ananse-c2.service
systemctl daemon-reload
systemctl restart ananse-c2
echo "C2 server restarting with new tokens."
TOKENS
  chmod +x /root/set-c2-tokens.sh

  ssh "$TARGET" "systemctl enable ananse-c2 2>/dev/null && systemctl start ananse-c2 2>/dev/null" || true
  echo "  ✓ C2 service installed (default tokens — CHANGE THEM)"
  echo "  ✓ Run /root/set-c2-tokens.sh to set custom tokens"
fi

# ── Step 6: UFW (optional) ─────────────────────────────────
echo "  >> Configuring firewall..."
ssh "$TARGET" bash -s << 'UFW'
  ufw --force reset 2>/dev/null
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw --force enable 2>/dev/null
  echo "  ✓ UFW active — SSH allowed"
UFW

if [ "$SETUP_C2" = true ]; then
  ssh "$TARGET" "ufw allow 8443/tcp 2>/dev/null && echo '  ✓ Port 8443 open (C2 server)'" || true
fi

# ── Step 7: Configure ananse ───────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Bootstrap complete!"
echo ""
echo "  SSH into your server:"
echo "    ssh $TARGET"
echo ""
echo "  Start ananse:"
echo "    /root/start-ananse.sh"
echo ""
echo "  Or manually:"
echo "    ssh $TARGET"
echo "    tmux new -s ananse"
echo "    cd /root/ananse && node dist/index.js"
echo "    # Ctrl+B D to detach"
echo "    # tmux attach -t ananse to resume"
echo ""

if [ "$SETUP_C2" = true ]; then
  echo "  C2 server:"
  echo "    systemctl status ananse-c2"
  echo "    /root/set-c2-tokens.sh    # change default tokens"
  echo "    Port 8443 is open in UFW."
  echo ""
fi

echo "  First run — configure API key:"
echo "    ananse configure"
echo ""
echo "  Or set mode directly (for offense/defense):"
echo "    ananse mode offense"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
