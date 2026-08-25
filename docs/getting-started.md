# Getting Started

LibRE Bayes is two cooperating pieces: a **FastAPI + pgmpy** inference backend, and a **React + Tauri** frontend
that runs either as a browser page (during development) or a native desktop app.

## Prerequisites

| Requirement | Version |
| --- | --- |
| Python | 3.10+ |
| Node.js | 18+ |
| Rust toolchain | stable (only needed for the desktop build -- see [Tauri prerequisites](https://tauri.app/start/prerequisites/)) |

## Fastest path: the one-click launcher

From the repo root, run the launcher for your OS -- `run.bat` (Windows), `./run.sh` (macOS/Linux), or
`python run.py` (any OS). The first run sets up the backend virtualenv and builds a release binary (a few
minutes); every run after that opens directly, since nothing forces a rebuild until you pass `--rebuild`. Pass
`--dev` to run via `tauri dev` (live reload) instead. This skips everything below -- read on only if you want to
run the pieces manually, or need a portable, no-installer-required copy (`python scripts/make_portable.py`, needs
only Python on the target machine afterward).

## 1. Run the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows -- use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

This starts the API at `http://127.0.0.1:8000`. Visit `http://127.0.0.1:8000/api/health` to confirm it's up --
you should see a JSON list of the currently-registered inference solvers.

## 2. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite proxies every `/api/*` request to the backend automatically, so the backend must already be running. Open
`http://localhost:5173` in a browser to use the app.

## 3. Or run it as a desktop app

Skip steps 1 and 2 entirely and just run:

```bash
cd frontend
npm run tauri dev
```

This launches the native window and spawns the FastAPI backend as a managed subprocess automatically. To build a
distributable installer:

```bash
npm run tauri build
```

## Your first network

1. Click **Add Node** a few times to place some variables on the canvas.
2. Drag from one node's edge to another to connect them as parent → child.
3. Select a node to open the **Inspector** -- add states, then fill in its Conditional Probability Table (CPT).
   Paste directly from Excel/Sheets, or use **Auto-Normalize** / **Uniform** / **Randomize**.
4. Switch to **Observation** mode and click a state on any node to pin it as evidence -- watch every other node's
   marginal update live (toggle **Auto Infer** off if you'd rather trigger inference manually with **Infer Now**).
5. Switch to **Intervention** mode to see the difference between `P(Y | X = x)` and Pearl's `P(Y | do(X = x))` --
   the intervened node's incoming edges are visibly cut.

From here: try **Find Most Likely Scenario** for a MAP query, **Fit from CSV** / **Auto-Discover DAG** to learn a
model from data, or head to [Dynamic Bayesian Networks](/dynamic-bayesian-networks) to model a process that
evolves over time.
