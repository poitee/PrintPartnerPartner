#!/usr/bin/env bash
#
# Start three real slicer_sidecar instances for the auto-slice end-to-end test,
# one per backend, each with a fake slicer CLI on PATH.
#
#   orca  -> 127.0.0.1:${E2E_PORT_ORCA:-8321}
#   prusa -> 127.0.0.1:${E2E_PORT_PRUSA:-8322}
#   bambu -> 127.0.0.1:${E2E_PORT_BAMBU:-8323}
#
# The sidecar service, its HTTP layer, subprocess execution, zip/thumbnail
# extraction and response encoding are all REAL; only the slicer binary itself
# is a stand-in, because no orca-slicer/prusa-slicer/bambu-studio build is
# installable in this environment. The fakes validate the argv and the full
# preset schema they are handed, so a bad translation fails the run rather than
# passing through.
#
# Usage:
#   e2e/start_sidecars.sh <path-to-slicer_sidecar-checkout> [<python>]
#   E2E_SIDECARS=1 npx vitest run src/services/auto-slice-e2e.test.ts
#   e2e/stop_sidecars.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="${1:-${SLICER_SIDECAR_DIR:-}}"
PYTHON="${2:-${SLICER_SIDECAR_PYTHON:-python3}}"
RUN_DIR="${E2E_RUN_DIR:-/tmp/pp-e2e-sidecars}"

if [[ -z "$SIDECAR_DIR" || ! -d "$SIDECAR_DIR/slicer_sidecar" ]]; then
  echo "usage: $0 <path-to-slicer_sidecar-checkout> [python]" >&2
  echo "  (the directory containing the slicer_sidecar/ package)" >&2
  exit 2
fi

mkdir -p "$RUN_DIR/bin"
# The sidecar resolves the CLI by name; give each flavour the name it looks for.
cp "$HERE/fake-orca-slicer" "$RUN_DIR/bin/orca-slicer"
cp "$HERE/fake-orca-slicer" "$RUN_DIR/bin/bambu-studio-cli"
cp "$HERE/fake-prusa-slicer" "$RUN_DIR/bin/prusa-slicer"
chmod +x "$RUN_DIR/bin/"*

start() {
  local name="$1" port="$2"
  "$PYTHON" -m uvicorn slicer_sidecar.app:app \
    --host 127.0.0.1 --port "$port" --log-level warning \
    >"$RUN_DIR/$name.log" 2>&1 &
  echo $! >"$RUN_DIR/$name.pid"
  echo "  $name -> http://127.0.0.1:$port (pid $(cat "$RUN_DIR/$name.pid"))"
}

cd "$SIDECAR_DIR"
export PATH="$RUN_DIR/bin:$PATH"
export ORCA_SLICER_BIN="$RUN_DIR/bin/orca-slicer"
export PRUSA_SLICER_BIN="$RUN_DIR/bin/prusa-slicer"
export BAMBU_STUDIO_CLI_BIN="$RUN_DIR/bin/bambu-studio-cli"

PORT_ORCA="${E2E_PORT_ORCA:-8321}"
PORT_PRUSA="${E2E_PORT_PRUSA:-8322}"
PORT_BAMBU="${E2E_PORT_BAMBU:-8323}"

echo "starting sidecars from $SIDECAR_DIR"
start orca "$PORT_ORCA"
start prusa "$PORT_PRUSA"
start bambu "$PORT_BAMBU"

# Wait on the PID we started, not just on the port: another process already
# holding the port would answer /healthz and mask our own bind failure.
for spec in "orca:$PORT_ORCA" "prusa:$PORT_PRUSA" "bambu:$PORT_BAMBU"; do
  name="${spec%%:*}"
  port="${spec##*:}"
  pid="$(cat "$RUN_DIR/$name.pid")"
  ok=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "sidecar '$name' (pid $pid) exited during startup:" >&2
      tail -n 20 "$RUN_DIR/$name.log" >&2
      exit 1
    fi
    if curl -sf "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ok" != "1" ]]; then
    echo "sidecar '$name' never became healthy on port $port; logs in $RUN_DIR" >&2
    tail -n 20 "$RUN_DIR/$name.log" >&2
    exit 1
  fi
done
echo "all three sidecars healthy (run dir: $RUN_DIR)"
