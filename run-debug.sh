#!/usr/bin/env bash
# Same as run.sh, but with verbose logging and devtools auto-opened -- use
# this when the app fails with a message that doesn't explain itself (e.g.
# a bare "inference request failed"). Logs land in logs/app.log and
# logs/backend.log next to the executable; devtools shows frontend/network
# errors directly.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[libre-bayes] ERROR: no python3/python found on PATH. Install Python 3.10+ first." >&2
  read -r -p "Press Enter to close..." _ || true
  exit 1
fi

if ! "$PYTHON" run.py --debug "$@"; then
  status=$?
  echo
  echo "[libre-bayes] exited with an error (see above, and logs/app.log / logs/backend.log)."
  read -r -p "Press Enter to close..." _ || true
  exit $status
fi
