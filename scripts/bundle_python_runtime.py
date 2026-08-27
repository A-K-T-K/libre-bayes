#!/usr/bin/env python3
"""Assembles a self-contained Python runtime for the portable build, so a
person running the portable app needs nothing preinstalled -- no Python, no
`pip install`, no internet access at first launch. This is what makes
`scripts/make_portable.py`'s output actually "portable": without it, the
app still needed a system Python interpreter to create its own virtualenv
on first run.

Uses the official python.org "embeddable" distribution (a zip of just the
interpreter + stdlib, no installer, no registry entries) as the base, then
copies this repo's own already-built `backend/.venv/Lib/site-packages`
into it -- reusing packages already resolved and installed for this exact
Python version/platform is much faster than having pip re-resolve and
redownload the same heavy scientific stack (numpy/scipy/pandas/pgmpy) a
second time, and gives the exact same dependency versions the rest of the
build was tested against.

Usage:
    python scripts/bundle_python_runtime.py <output_dir>

Requires `backend/.venv` to already exist (`python run.py` once, or
`python -m venv backend/.venv && backend/.venv/Scripts/pip install -r
backend/requirements.txt`, sets it up).
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_VENV = REPO_ROOT / "backend" / ".venv"

PYTHON_VERSION = "3.12.1"
EMBED_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
CACHE_DIR = REPO_ROOT / ".cache"

# Copying the interpreter's own stdlib/pip machinery would balloon the
# runtime for no benefit -- only third-party packages (and their metadata)
# are needed at runtime.
_SKIP_NAMES = {"__pycache__", "pip", "pip-*.dist-info", "setuptools", "setuptools-*.dist-info", "wheel", "wheel-*.dist-info"}


def log(msg: str) -> None:
    print(f"[bundle-python] {msg}", flush=True)


def download_embeddable_zip() -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    dest = CACHE_DIR / f"python-{PYTHON_VERSION}-embed-amd64.zip"
    if dest.is_file():
        log(f"reusing cached {dest}")
        return dest
    log(f"downloading {EMBED_URL}")
    urllib.request.urlretrieve(EMBED_URL, dest)
    return dest


def _should_skip(name: str) -> bool:
    import fnmatch

    return any(fnmatch.fnmatch(name, pattern) for pattern in _SKIP_NAMES)


def build(out_dir: Path) -> None:
    if not BACKEND_VENV.is_dir():
        raise SystemExit(
            f"{BACKEND_VENV} doesn't exist -- set up the backend virtualenv first "
            "(`python run.py` once, or `python -m venv backend/.venv && "
            "backend/.venv/Scripts/pip install -r backend/requirements.txt`)."
        )
    venv_site_packages = BACKEND_VENV / "Lib" / "site-packages"
    if not venv_site_packages.is_dir():
        raise SystemExit(f"{venv_site_packages} doesn't exist -- backend/.venv looks incomplete.")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    zip_path = download_embeddable_zip()
    log(f"extracting embeddable interpreter to {out_dir}")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(out_dir)

    pth_files = list(out_dir.glob("python3*._pth"))
    if not pth_files:
        raise SystemExit(f"no python3*._pth found in {out_dir} -- unexpected embeddable zip layout")
    pth_file = pth_files[0]
    # The embeddable distribution ships with site-packages/`import site`
    # disabled by default (it's meant for tiny standalone scripts) -- both
    # are needed for third-party packages to be importable at all. A `._pth`
    # file, once present, takes complete control of `sys.path` -- neither
    # the interpreter's usual cwd-on `-m` behavior nor `$PYTHONPATH` apply
    # any more, so `backend/` (sibling of this runtime, holding main.py and
    # the rest of the backend's own source) has to be listed explicitly or
    # `python -m uvicorn main:app` can't find `main`. Paths here resolve
    # relative to this runtime's own directory, so `..\backend` is right
    # regardless of the caller's cwd.
    pth_file.write_text(
        pth_file.read_text(encoding="utf-8").split("#import site")[0]
        + "..\\backend\nLib\\site-packages\n\nimport site\n",
        encoding="utf-8",
    )

    dest_site_packages = out_dir / "Lib" / "site-packages"
    dest_site_packages.mkdir(parents=True)
    log(f"copying {venv_site_packages} -> {dest_site_packages}")
    for entry in venv_site_packages.iterdir():
        if _should_skip(entry.name):
            continue
        dest = dest_site_packages / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(entry, dest)

    python_exe = out_dir / "python.exe"
    log("verifying the bundled runtime can import the backend's dependencies")
    import subprocess

    subprocess.run(
        [
            str(python_exe),
            "-c",
            "import fastapi, uvicorn, pgmpy, numpy, scipy, pandas, sklearn, opt_einsum; print('bundled runtime OK')",
        ],
        check=True,
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <output_dir>")
    build(Path(sys.argv[1]).resolve())


if __name__ == "__main__":
    main()
