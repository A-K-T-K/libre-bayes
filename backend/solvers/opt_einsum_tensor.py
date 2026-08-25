import numpy as np

from solver_registry import register_solver

from ._shared import assign_axis_labels, distribution_dict

try:
    import opt_einsum

    _HAS_OPT_EINSUM = True
except ImportError:  # pragma: no cover - optional dependency
    _HAS_OPT_EINSUM = False


@register_solver(
    "opt_einsum_tensor",
    label="Tensor: einsum",
    description="Pure vectorized tensor contraction; sub-millisecond on small/medium nets.",
)
def solve(payload, model, targets):
    """Contract the joint factorization P(X) = prod_i P(X_i | parents(X_i))
    directly as one big einsum expression, clamping evidence variables."""

    node_by_id = {n.id: n for n in payload.nodes}
    axis_labels = assign_axis_labels([n.id for n in payload.nodes])

    operands: list[np.ndarray] = []
    subscripts: list[str] = []

    for node in payload.nodes:
        card = len(node.states)
        parent_cards = [len(node_by_id[p].states) for p in node.parents]
        # pgmpy's TabularCPD column convention is a row-major (C-order)
        # reshape of the (card, prod(parent_cards)) matrix into
        # [card, *parent_cards] -- i.e. the last-listed parent's states
        # cycle fastest across columns. Match that exactly, then move the
        # variable's own axis to the end for einsum labeling.
        tensor = np.array(node.cpt, dtype=float).reshape([card] + parent_cards)
        tensor = np.moveaxis(tensor, 0, len(parent_cards))
        subscript = "".join(axis_labels[p] for p in node.parents) + axis_labels[node.id]
        operands.append(tensor)
        subscripts.append(subscript)

        if node.id in payload.evidence:
            state_idx = node.states.index(payload.evidence[node.id])
            mask = np.zeros(card)
            mask[state_idx] = 1.0
            operands.append(mask)
            subscripts.append(axis_labels[node.id])

    marginals: dict[str, dict[str, float]] = {}
    for target in targets:
        eq = ",".join(subscripts) + f"->{axis_labels[target]}"
        contract_fn = opt_einsum.contract if _HAS_OPT_EINSUM else np.einsum
        raw = contract_fn(eq, *operands)
        marginals[target] = distribution_dict(node_by_id[target].states, raw / raw.sum())

    return marginals
