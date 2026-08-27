#!/usr/bin/env python3
"""Assemble a portable, no-install-required copy of LibRE Bayes for the
current OS: a prebuilt release binary + a trimmed copy of backend/ +
(Windows) a fully self-contained Python runtime with every backend
dependency preinstalled, dropped into dist-portable/<os>/. Hand that whole
folder to someone else (zip it up) and it just runs -- no Node, no Rust,
no Python, no `pip install`, no internet access, nothing to type. Double-
click run.bat (or run app.exe directly) and it opens.

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
import bundle_python_runtime  # noqa: E402

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

    if IS_WINDOWS:
        # A full, working Python + every backend dependency, baked in at
        # package time -- this is what lets the launchers below skip
        # Python entirely rather than needing it installed on the machine
        # the app is run on. (No python.org "embeddable" distribution
        # exists for macOS/Linux, so those still fall back to run.py's
        # system-Python + venv-on-first-launch flow below.)
        run_module.log("bundling a self-contained Python runtime (this can take a minute)...")
        bundle_python_runtime.build(out_dir / "python-runtime")

        _write_windows_launchers(out_dir)
        readme = (
            "LibRE Bayes -- portable build\n"
            "==============================\n\n"
            "Nothing to install -- Python, every backend dependency, and the\n"
            "app itself are all bundled in this folder already. No installer,\n"
            "no admin rights, no internet access needed.\n\n"
            "Double-click run.bat to start it.\n\n"
            "If something fails (e.g. a bare 'inference request failed' with no\n"
            "further detail), run run-debug.bat instead -- it opens the devtools\n"
            "console for frontend/network errors and writes logs\\app.log (Rust\n"
            "side, including whether the backend process could even be started)\n"
            "and logs\\backend.log (the Python backend's own stdout/stderr, e.g.\n"
            "a startup traceback) next to the executable.\n"
        )
    else:
        for launcher in ("run.py", "run.sh", "run-debug.sh"):
            shutil.copy2(REPO_ROOT / launcher, out_dir / launcher)
        (out_dir / "run.sh").chmod(0o755)
        (out_dir / "run-debug.sh").chmod(0o755)
        readme = (
            "LibRE Bayes -- portable build\n"
            "==============================\n\n"
            "Requires Python 3.10+ on this machine (for the inference backend) --\n"
            "nothing else. No installer, no admin rights needed.\n\n"
            "Run: ./run.sh   (or: bash run.sh)\n\n"
            "The first launch sets up a local virtual environment (backend/.venv)\n"
            "and installs the backend's Python dependencies -- this only happens\n"
            "once. Every launch after that opens directly.\n\n"
            "If something fails (e.g. a bare 'inference request failed' with no\n"
            "further detail), run ./run-debug.sh instead -- it opens the devtools\n"
            "console for frontend/network errors and writes logs/app.log (Rust\n"
            "side, including whether the backend process could even be started)\n"
            "and logs/backend.log (the Python backend's own stdout/stderr, e.g.\n"
            "a startup traceback) next to the executable.\n"
        )

    (out_dir / "README.txt").write_text(readme, encoding="utf-8")

    run_module.log(f"portable build assembled at {out_dir}")


def _write_windows_launchers(out_dir: Path) -> None:
    """Self-contained launchers for the Windows portable build -- unlike
    run.bat at the repo root (which needs Python to run run.py's build/venv
    logic), these just start the already-built, already-fully-bundled
    app.exe directly. No Python required to even launch it."""

    (out_dir / "run.bat").write_text(
        "@echo off\r\n"
        "cd /d \"%~dp0\"\r\n"
        "start \"\" \"%~dp0app.exe\"\r\n",
        encoding="utf-8",
    )
    (out_dir / "run-debug.bat").write_text(
        "@echo off\r\n"
        "cd /d \"%~dp0\"\r\n"
        "set LIBRE_BAYES_DEBUG=1\r\n"
        "start \"\" \"%~dp0app.exe\"\r\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
