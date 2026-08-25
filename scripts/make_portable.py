#!/usr/bin/env python3
"""Assemble a portable, no-install-required copy of LibRE Bayes for the
current OS: a prebuilt release binary + a trimmed copy of backend/ + the
run.py/run.sh/run.bat launchers, dropped into dist-portable/<os>/. Hand
that whole folder to someone else (zip it up) and, as long as they have
Python 3.10+, `run.sh` / `run.bat` sets up the backend virtualenv on first
launch and just opens the app on every one after that -- no Node, no Rust,
no `pip install` typed by hand.

This only packages a binary for the OS it's run on -- Tauri builds aren't
cross-compiled here. Run it once per target OS (Windows/macOS/Linux) on
that OS.

Usage:
    python scripts/make_portable.py [--rebuild]
"""

from __future__ import annotations

import argparse
import platform
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
import run as run_module  # noqa: E402  -- reuses run.py's build/venv logic directly

IS_WINDOWS = platform.system() == "Windows"
OS_NAME = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(platform.system(), platform.system().lower())

# Backend files/dirs that are build artifacts or machine-specific, never
# part of a distributable copy.
_EXCLUDE_NAMES = {"__pycache__", ".venv", "venv"}


def _ignore(_dir: str, names: list[str]) -> set[str]:
    return {n for n in names if n in _EXCLUDE_NAMES or n.endswith(".pyc")}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rebuild", action="store_true", help="force a fresh release build even if one already exists")
    args = parser.parse_args()

    binary = run_module.release_binary_path()
    if args.rebuild or not binary.is_file():
        binary = run_module.build_release()
    else:
        run_module.log(f"reusing existing release build: {binary}")

    out_dir = REPO_ROOT / "dist-portable" / OS_NAME
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    exe_name = "app.exe" if IS_WINDOWS else "app"
    shutil.copy2(binary, out_dir / exe_name)
    if not IS_WINDOWS:
        (out_dir / exe_name).chmod(0o755)

    shutil.copytree(REPO_ROOT / "backend", out_dir / "backend", ignore=_ignore)

    for launcher in ("run.py", "run.sh", "run.bat"):
        shutil.copy2(REPO_ROOT / launcher, out_dir / launcher)
    (out_dir / "run.sh").chmod(0o755)

    (out_dir / "README.txt").write_text(
        "LibRE Bayes -- portable build\n"
        "==============================\n\n"
        "Requires Python 3.10+ on this machine (for the inference backend) --\n"
        "nothing else. No installer, no admin rights needed.\n\n"
        f"Windows : double-click run.bat\n"
        f"macOS/Linux : ./run.sh   (or: bash run.sh)\n\n"
        "The first launch sets up a local virtual environment (backend/.venv)\n"
        "and installs the backend's Python dependencies -- this only happens\n"
        "once. Every launch after that opens directly.\n",
        encoding="utf-8",
    )

    run_module.log(f"portable build assembled at {out_dir}")


if __name__ == "__main__":
    main()
