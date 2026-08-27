#!/usr/bin/env python3
"""Build (once) and launch LibRE Bayes.

Works from two layouts:
  1. A full source checkout (this file sitting next to frontend/ and
     backend/) -- the first run builds the Tauri release binary and sets up
     the backend's virtualenv; every run after that just launches the
     already-built binary, since building (especially the Rust side) is by
     far the slowest step and nothing here forces a rebuild on its own.
  2. A portable distribution assembled by scripts/make_portable.py -- a
     prebuilt binary plus a copy of backend/, no frontend/ or Rust
     toolchain involved at all. The only setup step left is the backend's
     virtualenv, created here on first launch.

Usage:
    python run.py            # build if needed, then launch
    python run.py --dev      # run via `tauri dev` instead (live reload)
    python run.py --rebuild  # force a fresh release build first
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import venv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
IS_WINDOWS = platform.system() == "Windows"


def log(msg: str) -> None:
    print(f"[libre-bayes] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"[libre-bayes] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def venv_python(venv_dir: Path) -> Path:
    return venv_dir / ("Scripts" if IS_WINDOWS else "bin") / ("python.exe" if IS_WINDOWS else "python")


def ensure_backend_venv(reinstall: bool) -> Path:
    """Creates backend/.venv and installs requirements.txt into it if
    missing (or if --rebuild was passed) -- this is the one setup step a
    portable distribution still needs, since a virtualenv bakes in absolute
    paths and can't just be copied from the build machine."""

    venv_dir = BACKEND_DIR / ".venv"
    python_path = venv_python(venv_dir)

    if python_path.is_file() and not reinstall:
        log(f"backend virtualenv already set up ({venv_dir})")
        return python_path

    log("setting up backend virtualenv (first run only)...")
    venv.EnvBuilder(with_pip=True, clear=reinstall).create(venv_dir)
    if not python_path.is_file():
        die(f"venv creation appears to have failed -- no interpreter at {python_path}")

    requirements = BACKEND_DIR / "requirements.txt"
    subprocess.run(
        [str(python_path), "-m", "pip", "install", "--quiet", "--upgrade", "pip"], check=True
    )
    subprocess.run(
        [str(python_path), "-m", "pip", "install", "--quiet", "-r", str(requirements)], check=True
    )
    log("backend dependencies installed")
    return python_path


def find_tool(name: str) -> str | None:
    return shutil.which(name)


def release_binary_path() -> Path:
    exe_name = "app.exe" if IS_WINDOWS else "app"
    # Portable layout: the binary sits right next to this script.
    portable = REPO_ROOT / exe_name
    if portable.is_file():
        return portable
    # Full source checkout: the Cargo/Tauri release output.
    return FRONTEND_DIR / "src-tauri" / "target" / "release" / exe_name


def build_release() -> Path:
    if not FRONTEND_DIR.is_dir():
        die(
            "no prebuilt binary found and there's no frontend/ to build from -- "
            "this looks like an incomplete portable copy."
        )

    npm = find_tool("npm")
    cargo = find_tool("cargo")
    missing = [
        name
        for name, tool in (("Node.js/npm", npm), ("Rust (cargo)", cargo))
        if tool is None
    ]
    if missing:
        die(
            "building requires tools that aren't on PATH: "
            + ", ".join(missing)
            + ". Install them, or fetch a prebuilt portable copy instead of building from source."
        )

    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.is_dir():
        log("installing frontend dependencies (first run only)...")
        subprocess.run([npm, "install"], cwd=FRONTEND_DIR, check=True, shell=IS_WINDOWS)

    log("building the release binary -- this can take a few minutes the first time...")
    subprocess.run([npm, "run", "tauri", "build"], cwd=FRONTEND_DIR, check=True, shell=IS_WINDOWS)

    binary = release_binary_path()
    if not binary.is_file():
        die(f"build finished but no binary was found at the expected path: {binary}")
    return binary


def run_dev() -> None:
    npm = find_tool("npm")
    if npm is None:
        die("Node.js/npm not found on PATH -- required for `tauri dev`.")
    ensure_backend_venv(reinstall=False)
    log("starting `tauri dev` (live reload)...")
    subprocess.run([npm, "run", "tauri", "dev"], cwd=FRONTEND_DIR, check=True, shell=IS_WINDOWS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dev", action="store_true", help="run via `tauri dev` (live reload) instead of a release build")
    parser.add_argument("--rebuild", action="store_true", help="force a fresh release build and virtualenv, even if one already exists")
    parser.add_argument(
        "--debug",
        action="store_true",
        help=(
            "verbose logging + auto-opened devtools, for diagnosing a failure "
            "that isn't self-explanatory in the UI (e.g. a bare 'inference "
            "request failed'). Writes logs/app.log (Rust/backend-spawn side) "
            "and logs/backend.log (the Python backend's own stdout/stderr) "
            "next to the executable; devtools shows frontend/network errors."
        ),
    )
    args = parser.parse_args()

    if not BACKEND_DIR.is_dir():
        die(f"backend/ not found next to this script ({REPO_ROOT})")

    if args.debug:
        os.environ["LIBRE_BAYES_DEBUG"] = "1"

    if args.dev:
        run_dev()
        return

    ensure_backend_venv(reinstall=args.rebuild)

    binary = release_binary_path()
    if args.rebuild or not binary.is_file():
        binary = build_release()
    else:
        log(f"already built -- launching {binary}")

    os.chdir(binary.parent)
    if args.debug:
        log(f"debug mode -- logs will be written to {binary.parent / 'logs'}")
    subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    main()
