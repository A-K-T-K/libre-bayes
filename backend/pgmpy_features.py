"""Parameter learning, structure learning, independence/Markov-blanket
queries, and forward sampling -- everything pgmpy-backed that isn't plain
marginal inference (that's `engine.py`)."""

from __future__ import annotations

import io

import numpy as np
import pandas as pd
from pgmpy.causal_discovery import ExpertKnowledge
from pgmpy.estimators import BayesianEstimator, HillClimbSearch, MaximumLikelihoodEstimator, PC, TreeSearch
from pgmpy.models import DiscreteBayesianNetwork

from engine import build_network
from errors import EngineError
from schema import (
    IndependenceRequest,
    IndependenceResponse,
    LearnedCpt,
    LearnParametersRequest,
    LearnParametersResponse,
    MarkovBlanketRequest,
    MarkovBlanketResponse,
    NetworkPayload,
    NodeDefinition,
    SimulateRequest,
    SimulateResponse,
    StructureLearnRequest,
    StructureLearnResponse,
)

__all__ = [
    "learn_parameters",
    "learn_structure",
    "query_independence",
    "query_markov_blanket",
    "simulate",
]


def _read_csv(csv_content: str) -> pd.DataFrame:
    try:
        df = pd.read_csv(io.StringIO(csv_content))
    except Exception as exc:  # noqa: BLE001
        raise EngineError(f"could not parse CSV: {exc}") from exc
    if df.empty:
        raise EngineError("CSV has no rows")
    return df


def _parent_combinations(parent_states: list[list[str]]) -> list[tuple[str, ...]]:
    """Cartesian product with the last parent cycling fastest -- must match
    the frontend's `parentStateCombinations` column ordering exactly."""

    combos: list[tuple[str, ...]] = [()]
    for states in parent_states:
        combos = [c + (s,) for c in combos for s in states]
    return combos


# ---------------------------------------------------------------- learning


def learn_parameters(req: LearnParametersRequest) -> LearnParametersResponse:
    df = _read_csv(req.csv_content)
    node_by_id = {n.id: n for n in req.nodes}

    missing = [node_id for node_id in req.column_mapping if node_id not in node_by_id]
    if missing:
        raise EngineError(f"column mapping references unknown node(s): {', '.join(missing)}")
    missing_cols = [col for col in req.column_mapping.values() if col not in df.columns]
    if missing_cols:
        raise EngineError(f"CSV has no column(s): {', '.join(missing_cols)}")

    mapped_ids = set(req.column_mapping)
    for node_id in mapped_ids:
        unmapped_parents = [p for p in node_by_id[node_id].parents if p not in mapped_ids]
        if unmapped_parents:
            raise EngineError(
                f"node '{node_id}' has parent(s) {', '.join(unmapped_parents)} that aren't mapped to a "
                f"CSV column -- map them too so their values are available to condition on"
            )

    data = df.rename(columns={col: node_id for node_id, col in req.column_mapping.items()})
    data = data[list(mapped_ids)].astype(str)

    # Scoped to just the mapped nodes: pgmpy's estimators require every
    # node in the scaffold structure to have a matching data column, so
    # including unmapped nodes here (even ones this call isn't fitting)
    # would fail outright.
    structure = DiscreteBayesianNetwork()
    structure.add_nodes_from(mapped_ids)
    structure.add_edges_from([(s, d) for s, d in req.edges if s in mapped_ids and d in mapped_ids])

    state_names = {node_id: node_by_id[node_id].states for node_id in mapped_ids}

    results: list[LearnedCpt] = []
    warnings: list[str] = []
    for node_id in req.column_mapping:
        node = node_by_id[node_id]
        parent_defs = [node_by_id[p] for p in node.parents]

        if req.estimator == "bayesian":
            estimator = BayesianEstimator(structure, data, state_names=state_names)
            cpd = estimator.estimate_cpd(
                node_id,
                prior_type=req.prior_type,
                equivalent_sample_size=req.equivalent_sample_size,
            )
        else:
            estimator = MaximumLikelihoodEstimator(structure, data, state_names=state_names)
            cpd = estimator.estimate_cpd(node_id)

        values = np.asarray(cpd.get_values(), dtype=float)
        # `get_values()` orders parent axes by `cpd.variables[1:]`, which
        # pgmpy builds from `node.parents` in declaration order -- already
        # the frontend's convention, so no reordering is needed here.

        sparse_columns: list[int] = []
        if parent_defs:
            combos = _parent_combinations([p.states for p in parent_defs])
            counts = data.groupby(node.parents, dropna=False).size()
            for col_idx, combo in enumerate(combos):
                key = combo[0] if len(combo) == 1 else combo
                if key not in counts.index or counts.loc[key] == 0:
                    sparse_columns.append(col_idx)
            if sparse_columns:
                warnings.append(
                    f"node '{node_id}': {len(sparse_columns)} parent combination(s) had zero "
                    f"training rows and fell back to a uniform distribution"
                )

        results.append(LearnedCpt(node_id=node_id, cpt=values.tolist(), sparse_columns=sparse_columns))

    return LearnParametersResponse(cpts=results, row_count=len(data), warnings=warnings)


def learn_structure(req: StructureLearnRequest) -> StructureLearnResponse:
    df = _read_csv(req.csv_content).astype(str)
    columns = list(df.columns)

    expert_knowledge = None
    if req.required_edges or req.forbidden_edges:
        expert_knowledge = ExpertKnowledge(
            required_edges=req.required_edges or None,
            forbidden_edges=req.forbidden_edges or None,
        )

    warnings: list[str] = []
    try:
        if req.algorithm == "pc":
            dag = PC(df).estimate(
                return_type="dag",
                expert_knowledge=expert_knowledge,
                enforce_expert_knowledge=expert_knowledge is not None,
                # Default n_jobs=-1 spawns a joblib process pool per
                # request; for the small/interactive networks this app
                # targets that's pure overhead (and orphaned workers add up
                # across repeated requests), so run in-process instead.
                n_jobs=1,
                show_progress=False,
            )
        elif req.algorithm == "treesearch":
            if expert_knowledge is not None:
                warnings.append("Tree Search (Chow-Liu) doesn't support required/forbidden edge constraints; ignored")
            dag = TreeSearch(df).estimate(show_progress=False)
        else:
            # HillClimbSearch wants one of its own string keys here, not a
            # score-class instance from `pgmpy.structure_score` -- passing
            # an instance raises despite being the documented public class.
            scoring_key = {"bic": "bic-d", "k2": "k2", "bdeu": "bdeu"}[req.scoring_method]
            dag = HillClimbSearch(df).estimate(
                scoring_method=scoring_key,
                expert_knowledge=expert_knowledge,
                show_progress=False,
            )
    except Exception as exc:  # noqa: BLE001 - surface pgmpy's own error
        raise EngineError(f"structure learning failed: {exc}") from exc

    edges = [(str(u), str(v)) for u, v in dag.edges()]
    learned_node_ids = set(dag.nodes()) | {n for edge in edges for n in edge}
    # Isolated columns the algorithm didn't connect still become nodes (as
    # roots) so no column silently disappears from the result.
    all_ids = list(dict.fromkeys([*columns, *learned_node_ids]))

    parents_of: dict[str, list[str]] = {node_id: [] for node_id in all_ids}
    for src, dst in edges:
        parents_of[dst].append(src)

    structure = DiscreteBayesianNetwork()
    structure.add_nodes_from(all_ids)
    structure.add_edges_from(edges)

    nodes: list[NodeDefinition] = []
    for node_id in all_ids:
        states = sorted(df[node_id].unique().tolist()) if node_id in df.columns else ["True", "False"]
        if len(states) < 2:
            states = states + ["_other"] if states else ["True", "False"]
        parents = parents_of[node_id]
        try:
            estimator = MaximumLikelihoodEstimator(structure, df, state_names={n: states for n in all_ids})
            cpd = estimator.estimate_cpd(node_id)
            cpt = np.asarray(cpd.get_values(), dtype=float).tolist()
        except Exception:  # noqa: BLE001 - fall back to a valid uniform CPT
            n_cols = 1
            for p in parents:
                n_cols *= len(states)
            cpt = [[1.0 / len(states)] * n_cols for _ in states]
        nodes.append(NodeDefinition(id=node_id, states=states, cpt=cpt, parents=parents))

    return StructureLearnResponse(nodes=nodes, edges=edges, warnings=warnings)


# ------------------------------------------------------------- explainers


def query_independence(req: IndependenceRequest) -> IndependenceResponse:
    payload = NetworkPayload(nodes=req.nodes, edges=req.edges)
    model = build_network(payload)

    if req.node_a not in model.nodes() or req.node_b not in model.nodes():
        raise EngineError("node_a/node_b must both exist in the network")

    connected = model.is_dconnected(req.node_a, req.node_b, observed=req.observed or None)
    d_separated = not connected

    observed_note = f" given {{{', '.join(req.observed)}}}" if req.observed else ""
    formal = f"({req.node_a} {'⊥' if d_separated else '⊥̸'} {req.node_b}{' | ' + ', '.join(req.observed) if req.observed else ''})"

    explanation = _explain_independence(model, req.node_a, req.node_b, req.observed, d_separated)

    return IndependenceResponse(d_separated=d_separated, formal=formal, explanation=explanation)


def _explain_independence(
    model: DiscreteBayesianNetwork, a: str, b: str, observed: list[str], d_separated: bool
) -> str:
    observed_set = set(observed)
    a_parents = set(model.get_parents(a))
    b_parents = set(model.get_parents(b))
    shares_child_observed = False
    for node in model.nodes():
        parents = set(model.get_parents(node))
        if a in parents and b in parents and (node in observed_set or _has_observed_descendant(model, node, observed_set)):
            shares_child_observed = True
            break

    if d_separated and not observed:
        return f"'{a}' and '{b}' share no active path in the current graph -- they're marginally independent."
    if d_separated:
        return (
            f"Conditioning on {{{', '.join(observed)}}} blocks every path between '{a}' and '{b}'; "
            f"they're conditionally independent given that evidence."
        )
    if shares_child_observed:
        return (
            f"'{a}' and '{b}' become dependent because they share a common effect (or a descendant of one) "
            f"that's been observed -- a V-structure / \"explaining away\" pattern."
        )
    if b in a_parents or a in b_parents:
        return f"'{a}' and '{b}' are directly connected by an edge, so they stay dependent."
    return f"An unblocked path still connects '{a}' and '{b}' through the rest of the network."


def _has_observed_descendant(model: DiscreteBayesianNetwork, node: str, observed: set[str]) -> bool:
    stack = list(model.get_children(node))
    seen: set[str] = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        if current in observed:
            return True
        stack.extend(model.get_children(current))
    return False


def query_markov_blanket(req: MarkovBlanketRequest) -> MarkovBlanketResponse:
    payload = NetworkPayload(nodes=req.nodes, edges=req.edges)
    model = build_network(payload)
    if req.node not in model.nodes():
        raise EngineError(f"unknown node '{req.node}'")

    parents = list(model.get_parents(req.node))
    children = list(model.get_children(req.node))
    spouses: set[str] = set()
    for child in children:
        spouses.update(model.get_parents(child))
    spouses.discard(req.node)
    spouses -= set(parents)

    return MarkovBlanketResponse(parents=parents, children=children, spouses=sorted(spouses))


# ------------------------------------------------------------------ sample


def simulate(req: SimulateRequest) -> SimulateResponse:
    payload = NetworkPayload(
        nodes=req.nodes,
        edges=req.edges,
        evidence=req.evidence,
    )
    model = build_network(payload)

    unknown_do = [n for n in req.do if n not in model.nodes()]
    if unknown_do:
        raise EngineError(f"do() references unknown node(s): {', '.join(unknown_do)}")

    try:
        df = model.simulate(
            n_samples=req.n_samples,
            do=req.do or None,
            evidence=req.evidence or None,
            seed=req.seed,
            show_progress=False,
        )
    except Exception as exc:  # noqa: BLE001
        raise EngineError(f"simulation failed: {exc}") from exc

    csv_text = df.to_csv(index=False)
    return SimulateResponse(csv_content=csv_text, row_count=len(df))
