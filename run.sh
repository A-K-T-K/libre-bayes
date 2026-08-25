#!/usr/bin/env bash
# Build (once) and launch LibRE Bayes on Linux/macOS.
#
# The heavy lifting lives in run.py (cross-platform); this just finds a
# Python interpreter and hands off to it. Double-clicking this file in a
# file manager depends on that file manager treating .sh as executable --
# not all of them do by default (macOS Finder in particular opens it as
# text unless told otherwise) -- running it from a terminal always works:
#   ./run.sh

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

if ! "$PYTHON" run.py "$@"; then
  status=$?
  echo
  echo "[libre-bayes] exited with an error (see above)."
  read -r -p "Press Enter to close..." _ || true
  exit $status
fi
