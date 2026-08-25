"""Helpers shared across solver plugins. Not auto-discovered (leading `_`)."""

from __future__ import annotations

from typing import Any

import numpy as np

from errors import EngineError


def assign_axis_labels(node_ids: list[str]) -> dict[str, str]:
    """einsum subscript letters, one per node, drawn from the printable
    ASCII/unicode range so arbitrarily large networks don't run out."""

    labels: dict[str, str] = {}
    pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    extended = [chr(i) for i in range(0x3B1, 0x3B1 + 200)]  # greek lowercase block
    all_symbols = list(pool) + extended
    for i, node_id in enumerate(node_ids):
        if i >= len(all_symbols):
            raise EngineError("network too large for einsum axis-label pool")
        labels[node_id] = all_symbols[i]
    return labels


def distribution_dict(states: list[str], values: np.ndarray) -> dict[str, float]:
    return {state: float(prob) for state, prob in zip(states, values)}


def factor_to_marginals(result: Any, targets: list[str]) -> dict[str, dict[str, float]]:
    """pgmpy's multi-variable query returns one joint factor OR, when a single
    variable is queried, the factor directly. Normalize both shapes into
    per-node marginals by summing out all other query variables."""

    marginals: dict[str, dict[str, float]] = {}
    joint = result if isinstance(result, dict) else {"__joint__": result}

    if "__joint__" in joint:
        factor = joint["__joint__"]
        for var in targets:
            marg = factor.marginalize([v for v in targets if v != var], inplace=False)
            marginals[var] = distribution_dict(marg.state_names[var], marg.values)
    else:
        for var, factor in joint.items():
            marginals[var] = distribution_dict(factor.state_names[var], factor.values)

    return marginals
