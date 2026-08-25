# Extending the Inference Engine

Every inference algorithm -- built-in or custom -- is a self-contained plugin registered via a decorator. Nothing
else in the app needs to know an algorithm's name in advance.

## Writing a plugin

Copy [`backend/solvers/_template.py`](https://github.com/A-K-T-K/libre-bayes/blob/main/backend/solvers/_template.py)
to a new file in `backend/solvers/` (any filename not starting with `_` is auto-discovered on startup):

```python
from pgmpy.models import DiscreteBayesianNetwork
from solver_registry import register_solver
from schema import NetworkPayload


@register_solver(
    "my_solver",                                 # stable id, sent as options.method
    label="My Custom Solver",                    # shown in the frontend dropdown
    description="One sentence about what makes this solver useful.",
    supports_sampling=False,                      # True reveals the sample-count control
)
def solve(
    payload: NetworkPayload,
    model: DiscreteBayesianNetwork,
    targets: list[str],
) -> dict[str, dict[str, float]]:
    # model is a fully-built, validated DiscreteBayesianNetwork -- hand it
    # straight to any pgmpy inference class. payload.evidence is already
    # available if you need it; evidence nodes are filled in automatically
    # by the caller, so `targets` never includes them.
    ...
    return {node_id: {state: probability, ...} for node_id in targets}
```

That's the entire contract. On the next backend restart, `my_solver` appears in the frontend's algorithm dropdown
automatically -- label, description, and sample-count control included, with zero frontend changes.

## Registering one live, from the app

You don't need to touch the filesystem at all: the **+ Custom Inference Method…** option in the algorithm dropdown
opens an in-app editor. Submitted code is validated, persisted as a real plugin file, and immediately selectable --
see [`backend/solvers/SCHEMA.md`](https://github.com/A-K-T-K/libre-bayes/blob/main/backend/solvers/SCHEMA.md) for
the exact contract the submitted code must follow.

## Design notes

- **Interventions are handled for you.** `do()`-surgery (cutting incoming edges, pinning a point-mass CPT) happens
  on `model` *before* your plugin ever runs, so every solver -- including custom ones -- transparently supports
  interventions with no extra code.
- **Dynamic BN inference reuses this exact same registry**, dispatching per-`(node, time slice)` variable against
  an unrolled static payload -- a plugin that only reads `model` and `payload.evidence`/`payload.options` (not
  `payload.nodes` directly) works for temporal queries with no changes at all. A plugin that *does* read
  `payload.nodes` directly (to build its own tensor contraction, say) still works correctly, since the payload
  handed to it during a temporal query is the fully unrolled one -- each `(node, slice)` pair as its own
  `NodeDefinition` with the right per-slice CPT already resolved.
