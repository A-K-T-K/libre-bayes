"""Core inference engine: DAG construction + running the registered solver.

Algorithms themselves live in `backend/solvers/` as self-contained plugins --
see `solvers/_template.py`. This module never references a specific
algorithm by name; it only knows about the `solver_registry` interface.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from collections import defaultdict

import numpy as np
from pgmpy.factors.discrete import TabularCPD
from pgmpy.global_vars import config as pgmpy_config
from pgmpy.models import DiscreteBayesianNetwork

import solvers  # noqa: F401 - importing the package runs its auto-discovery
from errors import EngineError
from schema import InferenceResponse, MapQueryResponse, NetworkPayload, NodeDefinition, TemporalInferenceResponse
from solver_registry import available_solvers, get_solver
from solvers._shared import distribution_dict

__all__ = [
    "EngineError",
    "available_solvers",
    "build_network",
    "run_inference",
    "run_map_query",
    "run_temporal_inference",
]

# Past this many unrolled (node, time-slice) variables, temporal inference
# -- always exact (see `run_temporal_inference`) -- gets a heads-up warning
# rather than silently risking the solver timeout below. A cheap proxy, not
# a real treewidth estimate: what actually governs VE's cost is how densely
# connected each slice is, not slice count, but this is enough to flag the
# common "way too many slices for a dense network" case before it times out.
_TEMPORAL_SIZE_WARNING_THRESHOLD = 40

# Columns within this tolerance of summing to 1.0 are treated as harmless
# floating-point drift (e.g. from JSON round-tripping) and silently
# renormalized rather than rejected -- see `_normalize_column_safeguard`.
_FLOAT_DRIFT_TOLERANCE = 1e-2
_EXACT_TOLERANCE = 1e-9

# Every solver call -- built-in or a user-submitted custom one -- runs on
# this pool with a timeout, so a slow or hung solver returns an error to
# the caller instead of blocking the server (or a future request) forever.
# This can't forcibly kill a runaway thread (Python has no safe way to do
# that), it just stops the request from waiting on it.
_SOLVER_TIMEOUT_SECONDS = 30
_solver_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="solver")


def build_network(payload: NetworkPayload) -> DiscreteBayesianNetwork:
    """Translate the wire-format payload into a pgmpy DiscreteBayesianNetwork."""

    node_by_id = {n.id: n for n in payload.nodes}
    model = DiscreteBayesianNetwork()
    model.add_nodes_from(node_by_id.keys())
    try:
        model.add_edges_from(payload.edges)
    except ValueError as exc:
        # pgmpy raises a bare ValueError for cycles/self-loops; surface it as
        # a normal validation error instead of an uncaught 500.
        raise EngineError(str(exc)) from exc

    for node in payload.nodes:
        parent_defs = [node_by_id[p] for p in node.parents]
        evidence_card = [len(p.states) for p in parent_defs]
        state_names = {node.id: node.states}
        for p in parent_defs:
            state_names[p.id] = p.states

        values = np.array(node.cpt, dtype=float)
        expected_cols = int(np.prod(evidence_card)) if evidence_card else 1
        if values.shape[1] != expected_cols:
            raise EngineError(
                f"node '{node.id}': cpt has {values.shape[1]} columns but "
                f"{expected_cols} were expected from parent cardinalities "
                f"{evidence_card}"
            )

        values = _normalize_column_safeguard(node.id, values)

        cpd = TabularCPD(
            variable=node.id,
            variable_card=len(node.states),
            values=values,
            evidence=node.parents or None,
            evidence_card=evidence_card or None,
            state_names=state_names,
        )
        model.add_cpds(cpd)

    if payload.interventions:
        _apply_interventions(model, node_by_id, payload.interventions)

    model.check_model()
    return model


def _apply_interventions(
    model: DiscreteBayesianNetwork,
    node_by_id: dict,
    interventions: dict[str, str],
) -> None:
    """Graph surgery for `do(X=x)`: cut every incoming edge to an intervened
    node and pin its CPT to a point mass at the chosen state, in place. This
    is Pearl's mutilated-graph construction -- doing it here (rather than via
    a separate causal-inference code path) means every registered solver,
    including user-submitted custom ones, transparently supports
    interventions with no changes of its own.
    """

    for node_id, state in interventions.items():
        node = node_by_id[node_id]
        if state not in node.states:
            raise EngineError(f"intervention do({node_id}={state!r}): unknown state for '{node_id}'")

        for parent in list(model.get_parents(node_id)):
            model.remove_edge(parent, node_id)

        old_cpd = model.get_cpds(node_id)
        if old_cpd is not None:
            model.remove_cpds(old_cpd)

        point_mass = np.zeros((len(node.states), 1))
        point_mass[node.states.index(state), 0] = 1.0
        model.add_cpds(
            TabularCPD(
                variable=node_id,
                variable_card=len(node.states),
                values=point_mass,
                state_names={node_id: node.states},
            )
        )


def _normalize_column_safeguard(node_id: str, values: np.ndarray) -> np.ndarray:
    """Reject columns that are genuinely wrong (way off from summing to 1),
    but silently renormalize columns that are merely off by floating-point
    noise -- pgmpy's own `TabularCPD`/`check_model` validation uses a much
    tighter tolerance than is realistic after JSON round-tripping or manual
    CPT editing, so without this a column like [0.30000000000000004, 0.7]
    can throw where the data is obviously fine.
    """

    col_sums = values.sum(axis=0)
    if not np.allclose(col_sums, 1.0, atol=_FLOAT_DRIFT_TOLERANCE):
        raise EngineError(
            f"node '{node_id}': cpt columns must sum to 1.0 "
            f"(got {col_sums.round(4).tolist()})"
        )
    if np.allclose(col_sums, 1.0, atol=_EXACT_TOLERANCE):
        return values

    safe_sums = np.where(col_sums == 0, 1.0, col_sums)
    return values / safe_sums


def _query_targets(payload: NetworkPayload) -> list[str]:
    evidence_keys = set(payload.evidence.keys())
    return [n.id for n in payload.nodes if n.id not in evidence_keys]


def run_inference(payload: NetworkPayload) -> InferenceResponse:
    solver = get_solver(payload.options.method)
    if solver is None:
        known = ", ".join(s.name for s in available_solvers())
        raise EngineError(f"unknown inference method '{payload.options.method}' (known: {known})")

    pgmpy_config.set_backend(payload.options.backend)

    model = build_network(payload)
    targets = _query_targets(payload)

    warnings: list[str] = []
    if not targets:
        warnings.append("all nodes are evidence; no marginals to compute")

    start = time.perf_counter()
    if targets:
        future = _solver_executor.submit(solver, payload, model, targets)
        try:
            marginals = future.result(timeout=_SOLVER_TIMEOUT_SECONDS)
        except FutureTimeoutError as exc:
            raise EngineError(
                f"solver '{payload.options.method}' timed out after {_SOLVER_TIMEOUT_SECONDS}s"
            ) from exc
    else:
        marginals = {}
    elapsed_ms = (time.perf_counter() - start) * 1000.0

    for node_id, state in payload.evidence.items():
        marginals[node_id] = {s: (1.0 if s == state else 0.0) for s in _states_of(payload, node_id)}

    return InferenceResponse(
        marginals=marginals,
        latency_ms=round(elapsed_ms, 4),
        method_used=payload.options.method,
        warnings=warnings,
    )


def run_map_query(payload: NetworkPayload) -> MapQueryResponse:
    """Most probable full explanation: the single joint assignment over every
    non-evidence node that maximizes P(assignment | evidence). Always exact
    (Variable Elimination) regardless of the currently-selected solver --
    MAP is a distinct operation pgmpy only implements exactly."""

    from pgmpy.inference import VariableElimination

    model = build_network(payload)
    targets = _query_targets(payload)
    if not targets:
        raise EngineError("all nodes are evidence; nothing to find a most-likely scenario for")

    infer = VariableElimination(model)
    try:
        map_states = infer.map_query(variables=targets, evidence=payload.evidence, show_progress=False)
    except Exception as exc:  # noqa: BLE001 - surface pgmpy's own error message
        raise EngineError(f"MAP query failed: {exc}") from exc

    assignment = {**payload.evidence, **map_states}
    probability = _joint_probability(model, assignment)
    return MapQueryResponse(assignment=assignment, probability=probability)


def _joint_probability(model: DiscreteBayesianNetwork, assignment: dict[str, str]) -> float:
    """P(assignment) computed directly from the model's own CPDs via the
    chain rule -- cheaper and exacter than running another inference pass
    once every variable's value is already pinned down."""

    prob = 1.0
    for cpd in model.get_cpds():
        var = cpd.variable
        var_idx = cpd.state_names[var].index(assignment[var])
        parents = cpd.variables[1:]
        if parents:
            parent_idx = tuple(cpd.state_names[p].index(assignment[p]) for p in parents)
            prob *= float(cpd.values[(var_idx, *parent_idx)])
        else:
            prob *= float(cpd.values[var_idx])
    return prob


def _states_of(payload: NetworkPayload, node_id: str) -> list[str]:
    for n in payload.nodes:
        if n.id == node_id:
            return n.states
    raise EngineError(f"unknown node '{node_id}'")


# (node_id, time_slice) -> the unrolled network's actual variable name.
_SliceMap = dict[tuple[str, int], str]


def _slice_id(node_id: str, t: int) -> str:
    return f"{node_id}__t{t}"


def _build_unrolled_payload(payload: NetworkPayload) -> tuple[NetworkPayload, _SliceMap]:
    """Expands a network containing temporal nodes into an ordinary static
    *NetworkPayload* (not just a pgmpy model) spanning `payload.
    dbn_time_slices` slices, each node renamed to ``f"{node_id}__t{slice}"``.
    A non-temporal node gets a fresh, identically-conditioned copy of its own
    `cpt` at every slice (its distribution doesn't evolve -- no persistence
    edge); a temporal node uses `transition_cpt` for every slice after the
    first, conditioned on its own previous-slice value plus its ordinary
    (current-slice) parents -- "self, one slice back" is just modeled as an
    extra parent. This mirrors pgmpy's own `DynamicBayesianNetwork.
    initialize_initial_state()` 2-TBN semantics, just generalized past two
    slices.

    Building a real `NetworkPayload` (rather than a bare pgmpy model, as an
    earlier version of this did) means the result can be fed straight into
    `build_network()` and every registered solver plugin unchanged -- some
    plugins (e.g. `opt_einsum_tensor`) read `payload.nodes`/`payload.evidence`
    directly rather than only the pgmpy model, so they need a real unrolled
    payload to see the right structure, not just a model object.
    """

    time_slices = payload.dbn_time_slices
    node_by_id = {n.id: n for n in payload.nodes}
    id_map: _SliceMap = {
        (node.id, t): _slice_id(node.id, t) for node in payload.nodes for t in range(time_slices)
    }

    unrolled_nodes: list[NodeDefinition] = []
    unrolled_edges: list[tuple[str, str]] = []
    for t in range(time_slices):
        for node in payload.nodes:
            use_transition = t > 0 and node.temporal
            if use_transition:
                cpt = node.transition_cpt or []
                parents = [id_map[(node.id, t - 1)]] + [id_map[(p, t)] for p in node.parents]
            else:
                cpt = node.cpt
                parents = [id_map[(p, t)] for p in node.parents]

            unrolled_nodes.append(
                NodeDefinition(id=id_map[(node.id, t)], states=node.states, cpt=cpt, parents=parents)
            )
            unrolled_edges.extend((p, id_map[(node.id, t)]) for p in parents)

    unrolled = NetworkPayload(
        nodes=unrolled_nodes,
        edges=unrolled_edges,
        evidence={id_map[(k, 0)]: v for k, v in payload.evidence.items()},
        interventions={id_map[(k, 0)]: v for k, v in payload.interventions.items()},
        options=payload.options,
    )
    return unrolled, id_map


def _virtual_evidence_cpds(payload: NetworkPayload, node_by_id: dict[str, NodeDefinition], id_map: _SliceMap) -> list:
    cpds = []
    for entry in payload.virtual_evidence:
        node = node_by_id[entry.node_id]
        values = np.array([[entry.distribution.get(state, 0.0)] for state in node.states])
        variable = id_map[(entry.node_id, entry.time_slice)]
        cpds.append(
            TabularCPD(variable=variable, variable_card=len(node.states), values=values, state_names={variable: node.states})
        )
    return cpds


def run_temporal_inference(payload: NetworkPayload) -> TemporalInferenceResponse:
    """Every node's marginal at every time slice, for a network with at
    least one temporal node. Dispatches through the same solver registry as
    `run_inference` -- Variable Elimination, Belief Propagation, Likelihood
    Weighting, any custom plugin -- *except* when `virtual_evidence` is set,
    which only pgmpy's `VariableElimination.query(virtual_evidence=...)`
    understands (no other solver's API accepts it), so that one case forces
    exact VE regardless of the picked method.

    Each target variable is queried *individually* rather than batching every
    (node, slice) into one `query(variables=[...many...])` call: pgmpy's
    greedy/einsum contraction path builds one joint tensor across every
    requested variable before splitting it into marginals, so asking for,
    say, 50 unrolled variables at once can try to materialize a tensor with
    50 free dimensions -- observed in testing to demand hundreds of
    terabytes on a network with as few as 4 nodes x 13 slices, despite the
    network itself having a small treewidth. Querying one variable at a time
    keeps every call's cost bounded by the *model's* treewidth instead.
    """

    if not any(n.temporal for n in payload.nodes):
        raise EngineError(
            "no temporal nodes in this network -- enable Dynamic BN and mark at least one node "
            "temporal (right-click it on the canvas) first"
        )

    node_by_id = {n.id: n for n in payload.nodes}
    unrolled, id_map = _build_unrolled_payload(payload)
    time_slices = payload.dbn_time_slices
    model = build_network(unrolled)

    targets = [
        id_map[(node.id, t)]
        for node in payload.nodes
        for t in range(time_slices)
        if id_map[(node.id, t)] not in unrolled.evidence
    ]

    warnings: list[str] = []
    unrolled_count = len(payload.nodes) * time_slices
    if unrolled_count > _TEMPORAL_SIZE_WARNING_THRESHOLD:
        warnings.append(
            f"Unrolled to {unrolled_count} variables ({len(payload.nodes)} nodes x {time_slices} slices). "
            "A densely-connected network may be slow or time out at this size -- try fewer time slices, or "
            "an approximate solver, if it does."
        )

    use_virtual_evidence = bool(payload.virtual_evidence)
    if use_virtual_evidence:
        from pgmpy.inference import VariableElimination

        if payload.options.method != "variable_elimination":
            warnings.append(
                f"Virtual evidence is set, which only exact Variable Elimination supports -- ignoring the "
                f"selected '{payload.options.method}' solver for this query."
            )
        virtual_evidence = _virtual_evidence_cpds(payload, node_by_id, id_map)
        infer = VariableElimination(model)

        def run_all() -> dict[str, dict[str, float]]:
            out: dict[str, dict[str, float]] = {}
            for var in targets:
                factor = infer.query(
                    variables=[var], evidence=unrolled.evidence or None, virtual_evidence=virtual_evidence, show_progress=False
                )
                out[var] = distribution_dict(factor.state_names[var], factor.values)
            return out
    else:
        solver = get_solver(payload.options.method)
        if solver is None:
            known = ", ".join(s.name for s in available_solvers())
            raise EngineError(f"unknown inference method '{payload.options.method}' (known: {known})")

        def run_all() -> dict[str, dict[str, float]]:
            out: dict[str, dict[str, float]] = {}
            for var in targets:
                out.update(solver(unrolled, model, [var]))
            return out

    start = time.perf_counter()
    if targets:
        future = _solver_executor.submit(run_all)
        try:
            result = future.result(timeout=_SOLVER_TIMEOUT_SECONDS)
        except FutureTimeoutError as exc:
            raise EngineError(
                f"temporal inference timed out after {_SOLVER_TIMEOUT_SECONDS}s across {unrolled_count} "
                "unrolled variables -- try reducing the number of time slices, or an approximate solver"
            ) from exc
    else:
        result = {}
    elapsed_ms = (time.perf_counter() - start) * 1000.0

    marginals: dict[str, dict[int, dict[str, float]]] = defaultdict(dict)
    for node in payload.nodes:
        for t in range(time_slices):
            sid = id_map[(node.id, t)]
            if sid in unrolled.evidence:
                marginals[node.id][t] = {s: (1.0 if s == unrolled.evidence[sid] else 0.0) for s in node.states}
            else:
                marginals[node.id][t] = result[sid]

    return TemporalInferenceResponse(marginals=dict(marginals), latency_ms=round(elapsed_ms, 4), warnings=warnings)
