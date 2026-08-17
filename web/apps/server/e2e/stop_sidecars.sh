#!/usr/bin/env bash
# Stop the sidecars started by start_sidecars.sh.
set -uo pipefail
RUN_DIR="${E2E_RUN_DIR:-/tmp/pp-e2e-sidecars}"
for name in orca prusa bambu; do
  pidfile="$RUN_DIR/$name.pid"
  [[ -f "$pidfile" ]] || continue
  pid="$(cat "$pidfile")"
  if kill "$pid" 2>/dev/null; then
    echo "stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done
