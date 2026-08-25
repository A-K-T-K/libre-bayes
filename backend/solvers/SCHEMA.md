# Custom solver plugin schema

This is the one contract every inference solver in this app follows,
whether it ships built-in (`backend/solvers/*.py`) or is added at runtime
through the app's "+ Custom Inference Method…" dialog. There is exactly one
required piece: a top-level function named `solve` with this signature.

```python
def solve(payload, model, targets):
    """
    payload: NetworkPayload
        The raw request. Useful fields:
          - payload.evidence: dict[str, str]      -- {node_id: pinned_state}
          - payload.options.n_samples: int | None -- only if your method samples
          - payload.options.backend: "numpy" | "torch"
          - payload.nodes / payload.edges          -- the wire-format graph,
            if you'd rather work from that than the pgmpy model below

    model: pgmpy.models.DiscreteBayesianNetwork
        Fully built and validated -- every node, edge, and CPD is already
        attached. Hand it directly to any pgmpy inference class.

    targets: list[str]
        Node ids to compute a marginal for (every node NOT already pinned
        as evidence -- you never need to handle evidence nodes yourself,
        the caller fills those in as 100%/0% after your function returns).

    Returns
    -------
    dict[str, dict[str, float]]
        {node_id: {state_name: probability}} for every id in `targets`.
        Each inner dict's values should sum to ~1.0.
    """
```

## Registering it

Built-in solvers wrap `solve` with a decorator that gives it a stable id, a
display label, and a description:

```python
from solver_registry import register_solver

@register_solver(
    "my_solver",                 # id sent as options.method; snake_case
    label="My Custom Solver",    # shown in the frontend's algorithm picker
    description="One sentence about what makes this solver useful.",
    supports_sampling=False,     # True if you read payload.options.n_samples
)
def solve(payload, model, targets):
    ...
```

Drop a file with this pattern into `backend/solvers/` and it is
auto-discovered on startup -- nothing else in the codebase changes. See
`backend/solvers/_template.py` for a copy-paste skeleton.

## Registering it from the app (no file editing)

The frontend's "+ Custom Inference Method…" dialog (algorithm dropdown →
last item) sends `{name, label, description, code}` to
`POST /api/solvers/custom`, where `code` is exactly the body you'd write in
a plugin file -- a `def solve(payload, model, targets): ...` definition
(imports and helper functions are fine too; everything installed in the
backend's Python environment is available, e.g. `numpy`, `pgmpy`,
`itertools`). The backend:

1. Parses your code and checks it defines a top-level `solve` function.
2. Writes it to `backend/solvers/custom_<name>.py` in the exact same
   plugin format shown above, so it's a real, persistent plugin -- it
   survives app restarts and can be hand-edited afterward like any other
   file in `solvers/`.
3. Imports it immediately, so it shows up in the dropdown without a
   restart.

If the code fails to parse or import, the file is not kept and the error
is reported back to the dialog.

## Execution model (read this before writing slow code)

Every solver call -- built-in or custom -- runs on a worker thread with a
30-second timeout (see `engine.py`), separate from the request that's
waiting on it. A slow or hung solver returns a timeout error to the caller
instead of blocking the server (or the desktop app's UI, which is a
completely separate process from the Python backend to begin with). It
does **not** forcibly kill a runaway thread -- Python can't do that safely
-- so a truly infinite loop will keep a background thread alive until the
process exits; keep custom solvers finite.

## Trust model

Custom solver code runs with the same privileges as the rest of the
backend -- there is no sandboxing. This mirrors a local desktop app's
plugin/macro model (the same trust level as, say, enabling macros in a
document editor): only register code you wrote or trust, on your own
machine.

## Minimal working example

```python
def solve(payload, model, targets):
    from pgmpy.inference import VariableElimination
    infer = VariableElimination(model)
    marginals = {}
    for var in targets:
        factor = infer.query(variables=[var], evidence=payload.evidence or None, show_progress=False)
        states = factor.state_names[var]
        marginals[var] = {s: float(p) for s, p in zip(states, factor.values)}
    return marginals
```
