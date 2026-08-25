<p align="center">
  <img src="icon.svg" width="72" height="72" alt="LibRE Bayes logo — a Bayesian network icon">
</p>

<h1 align="center">LibRE Bayes</h1>

<p align="center">
  <strong>A free, open-source, cross-platform desktop editor for Bayesian Networks and Dynamic Bayesian Networks (DBNs).</strong>
</p>

<p align="center">
  Design directed acyclic graphs, edit conditional probability tables, run exact and approximate probabilistic inference,
  learn structure and parameters from data, and model temporal (time-sliced) processes — all in one native app,
  built on <a href="https://pgmpy.org/">pgmpy</a>, FastAPI, React, and Tauri.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/python-3.10%2B-blue.svg" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/node-18%2B-339933.svg" alt="Node 18+">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#dynamic-bayesian-networks">Dynamic BN</a> ·
  <a href="#data-contract">Data Contract</a> ·
  <a href="#extending-the-inference-engine">Extending</a> ·
  <a href="#project-structure">Project Structure</a>
</p>

---

**LibRE Bayes** ("Libre" — free, as in freedom) is a GUI-first alternative to tools like GeNIe/SMILE and Netica for
building, inspecting, and querying probabilistic graphical models. If you're teaching or learning Bayesian
inference, doing causal-reasoning research, prototyping a diagnostic or reliability model, or need a fast way to
explore `do()`-interventions, d-separation, and Markov blankets on a graph, this is built for exactly that —
without vendor lock-in or a paid license.

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend (FastAPI + pgmpy)](#backend-fastapi--pgmpy)
  - [Frontend (React + Vite)](#frontend-react--vite)
  - [Desktop app (Tauri)](#desktop-app-tauri)
- [Dynamic Bayesian Networks](#dynamic-bayesian-networks)
- [Inference Algorithms](#inference-algorithms)
- [Import / Export Formats](#import--export-formats)
- [Data Contract](#data-contract)
- [Extending the Inference Engine](#extending-the-inference-engine)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [License](#license)

## Features

**Modeling canvas**
- Drag-and-drop directed acyclic graph editor (React Flow) with auto-layout (Dagre), multi-select alignment/
  distribution tools, and undo/redo history
- Two node display styles per variable: a labeled circle (marginal + top state) or a live mini bar chart, one bar
  per state, resizable per node or as a group
- Design, Observation, and Intervention modes — click a state to set hard evidence (`X = x`) in Observation mode,
  or a `do(X = x)` causal intervention in Intervention mode, with the incoming edges visibly cut

**Conditional Probability Tables**
- Spreadsheet-style CPT editor (Handsontable) with Excel/Sheets paste support, per-column stochastic validation,
  auto-normalize, uniform-fill, and randomize actions
- Expandable full-screen table view for wide CPTs with many parent-state combinations

**Inference**
- Pluggable solver architecture — Exact Variable Elimination, Exact Belief Propagation (junction tree), Approximate
  Likelihood Weighting (vectorized sampling), and a pure-tensor `opt_einsum` contraction solver ship out of the box
- MAP queries ("most likely scenario"): the single highest-probability full joint assignment consistent with
  current evidence
- Author and register your own inference algorithm from inside the app — no backend redeploy required

**Learning from data**
- Structure learning from CSV via Hill-Climb search, the PC algorithm, or Tree Search, with BIC/K2/BDeu scoring and
  required/forbidden edge constraints
- Parameter learning (CPT fitting) via Maximum Likelihood or Bayesian estimation (BDeu / Dirichlet / K2 priors)
- Synthetic data generation: forward- or intervention-sample the current network to a CSV

**Explainability**
- d-separation / conditional-independence checker with a plain-language explanation
- Markov blanket inspector (parents, children, and co-parents of any node)

**Dynamic Bayesian Networks** — see [below](#dynamic-bayesian-networks) for details

**Import / export**
- JSON (native), BIF, Hugin NET, GeNIe/SMILE XDSL, and DSC — round-trip your models with the tools you already use

## Screenshots

_Coming soon — run the app locally (see [Getting Started](#getting-started)) to see the canvas, CPT editor, and
Dynamic BN Inspector in action._

## Getting Started

### Prerequisites

| Requirement | Version |
| --- | --- |
| Python | 3.10+ |
| Node.js | 18+ |
| Rust toolchain | stable (only for the desktop build — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)) |

### Backend (FastAPI + pgmpy)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows — use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`POST /api/infer` accepts a `NetworkPayload` (see [`backend/schema.py`](backend/schema.py)) and returns an
`InferenceResponse`. Every solver is a self-contained plugin registered via `@register_solver(...)` in
[`backend/solvers/`](backend/solvers) — see [Extending the Inference Engine](#extending-the-inference-engine).

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` to `http://127.0.0.1:8000`, so start the backend first, then open
[http://localhost:5173](http://localhost:5173).

### Desktop app (Tauri)

```bash
cd frontend
npm run tauri dev
```

This launches the native window and spawns the FastAPI backend as a managed subprocess automatically — no separate
`uvicorn` step needed. Build a distributable installer with `npm run tauri build`.

## Dynamic Bayesian Networks

LibRE Bayes supports authoring and querying temporal models directly on the same canvas as a static network:

1. Toggle **Dynamic BN** in the toolbar and set how many time slices to unroll.
2. Right-click any node → **Enable Temporal** to give it a `t-1 → t` persistence edge (shown with a small clock
   badge on the node) and a second CPT — the *transition* table, conditioned on the node's own previous-slice value
   plus its ordinary parents.
3. Set **virtual (soft) evidence** at any time slice from the Inspector — a likelihood-weighted constraint rather
   than a hard assignment, via pgmpy's `virtual_evidence` — and inspect each node's marginal-probability
   trajectory as a point-marked, gridded line chart (expandable to full-screen).

Temporal inference dispatches through the same solver registry as static inference — exact or approximate, built-in
or custom — querying one variable at a time so it stays correct and bounded regardless of how many slices you
unroll to.

## Inference Algorithms

| Algorithm | Type | Notes |
| --- | --- | --- |
| Variable Elimination | Exact | General-purpose default |
| Belief Propagation | Exact | Junction-tree message passing |
| Likelihood Weighting | Approximate | Vectorized weighted sampling; fast on large/dense networks |
| `opt_einsum` tensor contraction | Exact | Sub-millisecond on small/medium networks |
| *Your custom plugin* | Either | Authored and registered from the app itself |

## Import / Export Formats

| Format | Extension | Notes |
| --- | --- | --- |
| Native JSON | `.json` | Full fidelity, including Dynamic BN fields |
| Bayesian Interchange Format | `.bif` | |
| Hugin NET | `.net` | |
| GeNIe / SMILE | `.xdsl` | |
| DSC | `.dsc` | |

## Data Contract

Frontend and backend communicate through one polymorphic JSON schema, kept in lock-step between
[`backend/schema.py`](backend/schema.py) and [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts):

- `NodeDefinition { id, states[], cpt[][], parents[], position?, temporal?, transition_cpt? }`
- `InferenceOptions { method, n_samples?, backend }`
- `NetworkPayload { nodes[], edges[][2], evidence{}, interventions{}, options, dbn_time_slices?, virtual_evidence[]? }`
- `InferenceResponse { marginals{}, latency_ms, method_used, warnings[] }`
- `TemporalInferenceResponse { marginals{node → slice → state → probability}, latency_ms, warnings[] }`

`cpt` rows are the node's own states; columns are the Cartesian product of parent states in declared-parent order,
with the last-listed parent's states cycling fastest (matches pgmpy's `TabularCPD` column convention). A temporal
node's `transition_cpt` follows the same rule, treating its own previous-slice value as an implicit leading parent.

## Extending the Inference Engine

Drop a new file into [`backend/solvers/`](backend/solvers) that calls `@register_solver("name")` on a function
matching `(payload, model, targets) -> {node_id: {state: probability}}` — see
[`backend/solvers/_template.py`](backend/solvers/_template.py) for an annotated skeleton. It's auto-discovered on
startup and immediately selectable from the frontend's algorithm picker with no other code changes. You can also
author and register one live from the app via the **+ Custom Inference Method…** dialog.

## Project Structure

```
bayes/
├── backend/              FastAPI + pgmpy inference engine
│   ├── engine.py          Network construction, solver dispatch, MAP/temporal queries
│   ├── schema.py           Pydantic v2 wire-format contract
│   ├── solvers/            Pluggable inference algorithms
│   ├── pgmpy_features.py   Structure/parameter learning, independence, simulation
│   └── formats.py          BIF / NET / XDSL / DSC import & export
└── frontend/              React + TypeScript + Tauri desktop app
    ├── src/components/     Canvas, CPT editor, dialogs, toolbars
    ├── src/store/           Zustand state (network, inference, undo/redo)
    ├── src/lib/             Shared types, CPT math, layout, import/export
    └── src-tauri/           Rust shell — window, sidecar backend, native icons
```

## Tech Stack

**Backend:** Python, FastAPI, Pydantic v2, [pgmpy](https://pgmpy.org/), NumPy, opt_einsum
**Frontend:** React, TypeScript, Vite, Zustand + zundo (undo/redo), [React Flow](https://reactflow.dev/),
Fluent UI v9, Handsontable, Dagre
**Desktop:** [Tauri](https://tauri.app/) (Rust)

## License

[MIT](LICENSE) — free to use, modify, and distribute.
