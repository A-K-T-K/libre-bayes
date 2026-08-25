"""Copy this file to a new name (e.g. `my_solver.py`) to add a custom
inference algorithm. Any file in this package NOT starting with `_` is
auto-imported at startup -- that's the only wiring required. It will
immediately appear in the frontend's algorithm dropdown (label/description
included) with no other code changes anywhere in the app.

Delete this docstring and the two lines below once you've adapted it -- this
file itself is skipped by auto-discovery because it starts with `_`.
"""

from __future__ import annotations

from pgmpy.models import DiscreteBayesianNetwork

from solver_registry import register_solver
from schema import NetworkPayload


@register_solver(
    # Stable id sent as `options.method` in API requests. Use snake_case.
    "my_solver",
    # Optional: shown in the frontend dropdown. Defaults to a title-cased
    # version of the id above if omitted.
    label="My Custom Solver",
    # Optional: shown as a tooltip. Defaults to this function's docstring.
    description="One sentence describing what makes this solver useful.",
    # Optional: set True if you read `payload.options.n_samples` (e.g. a
    # Monte Carlo method) -- the frontend shows the sample-count control
    # only when this is True, with no frontend changes needed either way.
    supports_sampling=False,
)
def solve(
    payload: NetworkPayload,
    model: DiscreteBayesianNetwork,
    targets: list[str],
) -> dict[str, dict[str, float]]:
    """
    Parameters
    ----------
    payload: the raw request -- use `payload.evidence` (dict[node_id, state])
        and `payload.options.n_samples` / `.backend` if your algorithm needs
        them. `payload.nodes` / `payload.edges` are also available if you'd
        rather work from the wire format directly than the pgmpy model.
    model: a fully-built, validated `DiscreteBayesianNetwork` (nodes, edges,
        and CPDs already attached) -- ready to hand to any pgmpy inference
        class.
    targets: the node ids to compute marginals for (every node that is NOT
        already pinned as evidence).

    Returns
    -------
    A dict mapping each target node id to a dict of {state_name: probability}.
    Evidence nodes are filled in automatically by the caller -- you never
    need to include them.
    """
    raise NotImplementedError
