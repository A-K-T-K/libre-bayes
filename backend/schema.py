"""Pydantic v2 data models for the unified Bayesian Network JSON contract.

These models are the single source of truth for the shape of data exchanged
between the frontend and backend. Keep them in lock-step with the TypeScript
types in `frontend/src/lib/types.ts`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# A plain string, not a fixed Literal: the set of valid values is whatever
# is currently registered in `solver_registry` (see `solvers/_template.py`),
# which can grow at runtime as plugins are added. `engine.run_inference`
# validates against the live registry and raises a clear EngineError for an
# unknown method instead of relying on schema-level enforcement.
InferenceMethod = str

InferenceBackend = Literal["numpy", "torch"]


class Position(BaseModel):
    x: float
    y: float


class NodeDefinition(BaseModel):
    """A single discrete random variable in the network."""

    id: str = Field(..., min_length=1)
    states: list[str] = Field(..., min_length=2)
    cpt: list[list[float]] = Field(..., min_length=1)
    parents: list[str] = Field(default_factory=list)
    position: Position | None = None
    # Dynamic-BN fields, both frontend-authored: `temporal` marks this node
    # as persisting across time slices (a (node, t-1) -> (node, t) edge is
    # implied, not listed in `parents`/`edges`); `transition_cpt` is then
    # its CPD for every slice after the first, conditioned on its own
    # previous-slice value *and* its ordinary (current-slice) parents --
    # `cpt` remains its slice-0 ("initial state") CPD, conditioned on
    # parents only. See `engine._unroll_temporal_network` for how the two
    # get stitched into an ordinary static network per time slice.
    temporal: bool = False
    transition_cpt: list[list[float]] | None = None

    @field_validator("states")
    @classmethod
    def states_unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("states must be unique")
        return v

    @model_validator(mode="after")
    def cpt_row_count_matches_states(self) -> "NodeDefinition":
        if len(self.cpt) != len(self.states):
            raise ValueError(
                f"node '{self.id}': cpt has {len(self.cpt)} rows but "
                f"{len(self.states)} states were declared"
            )
        col_lengths = {len(row) for row in self.cpt}
        if len(col_lengths) > 1:
            raise ValueError(f"node '{self.id}': cpt rows have inconsistent lengths")
        return self

    @model_validator(mode="after")
    def transition_cpt_matches_states(self) -> "NodeDefinition":
        # Column count depends on parent cardinalities, which this model
        # doesn't know in isolation (parents are just ids here) -- that
        # check happens in `engine._unroll_temporal_network`, exactly like
        # `cpt`'s own column count is only checked in `engine.build_network`.
        if not self.temporal:
            return self
        if self.transition_cpt is None:
            raise ValueError(f"node '{self.id}' is temporal but has no transition_cpt")
        if len(self.transition_cpt) != len(self.states):
            raise ValueError(
                f"node '{self.id}': transition_cpt has {len(self.transition_cpt)} rows but "
                f"{len(self.states)} states were declared"
            )
        col_lengths = {len(row) for row in self.transition_cpt}
        if len(col_lengths) > 1:
            raise ValueError(f"node '{self.id}': transition_cpt rows have inconsistent lengths")
        return self


class VirtualEvidenceEntry(BaseModel):
    """A soft/likelihood constraint on one node at one time slice -- unlike
    `NetworkPayload.evidence` (a hard `X = state` assertion), this reweights
    belief via Jeffrey's rule without claiming the state is certain. Passed
    straight through to pgmpy's `VariableElimination.query(virtual_evidence=...)`,
    which expects exactly this shape: one likelihood value per state, not
    necessarily normalized to 1 (it's a likelihood ratio, not a probability)."""

    node_id: str = Field(..., min_length=1)
    time_slice: int = Field(default=0, ge=0)
    distribution: dict[str, float] = Field(..., min_length=1)

    @field_validator("distribution")
    @classmethod
    def distribution_values_in_range(cls, v: dict[str, float]) -> dict[str, float]:
        for state, value in v.items():
            if not (0.0 <= value <= 1.0):
                raise ValueError(f"virtual evidence value for state '{state}' must be in [0, 1] (got {value})")
        return v


class InferenceOptions(BaseModel):
    method: InferenceMethod = "variable_elimination"
    n_samples: int | None = Field(default=10_000, ge=100, le=200_000)
    backend: InferenceBackend = "numpy"


class NetworkPayload(BaseModel):
    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    evidence: dict[str, str] = Field(default_factory=dict)
    # Causal do()-interventions, distinct from `evidence` (observation): an
    # intervened node has its incoming edges surgically removed and its CPT
    # replaced with a point mass at the chosen state before the selected
    # solver runs, so `P(Y | do(X=x))` and `P(Y | X=x)` can genuinely differ.
    interventions: dict[str, str] = Field(default_factory=dict)
    options: InferenceOptions = Field(default_factory=InferenceOptions)
    # Dynamic-BN fields -- both no-ops for `/api/infer`/`/api/infer/map`
    # (which only ever see slice 0), used by `/api/infer/temporal`. `evidence`
    # and `interventions` above are always interpreted as slice-0 (initial
    # state) observations; per-slice soft constraints go through
    # `virtual_evidence` instead, which does carry an explicit time slice.
    dbn_time_slices: int = Field(default=1, ge=1, le=50)
    virtual_evidence: list[VirtualEvidenceEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_graph_consistency(self) -> "NetworkPayload":
        node_ids = {n.id for n in self.nodes}
        if len(node_ids) != len(self.nodes):
            raise ValueError("duplicate node ids in payload")

        for src, dst in self.edges:
            if src not in node_ids or dst not in node_ids:
                raise ValueError(f"edge ({src} -> {dst}) references an unknown node")

        for node in self.nodes:
            for parent in node.parents:
                if parent not in node_ids:
                    raise ValueError(
                        f"node '{node.id}' declares unknown parent '{parent}'"
                    )
                if (parent, node.id) not in self.edges:
                    raise ValueError(
                        f"node '{node.id}' lists parent '{parent}' but no matching "
                        f"edge ({parent} -> {node.id}) exists"
                    )

        for name in self.evidence:
            if name not in node_ids:
                raise ValueError(f"evidence references unknown node '{name}'")

        for name in self.interventions:
            if name not in node_ids:
                raise ValueError(f"intervention references unknown node '{name}'")

        overlap = set(self.evidence) & set(self.interventions)
        if overlap:
            raise ValueError(
                f"node(s) {sorted(overlap)} can't be both observed evidence and a "
                f"do()-intervention at the same time"
            )

        nodes_by_id = {n.id: n for n in self.nodes}
        for entry in self.virtual_evidence:
            if entry.node_id not in node_ids:
                raise ValueError(f"virtual evidence references unknown node '{entry.node_id}'")
            if entry.time_slice >= self.dbn_time_slices:
                raise ValueError(
                    f"virtual evidence on '{entry.node_id}' targets time slice {entry.time_slice} "
                    f"but dbn_time_slices is only {self.dbn_time_slices}"
                )
            unknown_states = set(entry.distribution) - set(nodes_by_id[entry.node_id].states)
            if unknown_states:
                raise ValueError(
                    f"virtual evidence on '{entry.node_id}' references unknown state(s) {sorted(unknown_states)}"
                )

        return self


class InferenceResponse(BaseModel):
    marginals: dict[str, dict[str, float]]
    latency_ms: float
    method_used: str
    warnings: list[str] = Field(default_factory=list)


class TemporalInferenceResponse(BaseModel):
    """Every node's marginal at every unrolled time slice -- keyed
    node_id -> time_slice -> state -> probability (the middle key becomes a
    JSON string, since JSON object keys are always strings)."""

    marginals: dict[str, dict[int, dict[str, float]]]
    latency_ms: float
    warnings: list[str] = Field(default_factory=list)


class SolverDescriptor(BaseModel):
    """Advertises one registered solver plugin to the frontend, which uses
    this to populate the algorithm picker dynamically -- adding a solver on
    the backend needs no frontend changes."""

    name: str
    label: str
    description: str = ""
    supports_sampling: bool = False


class CustomSolverRequest(BaseModel):
    """Submitted by the "+ Custom Inference Method…" dialog. See
    solvers/SCHEMA.md for the full contract `code` must follow."""

    name: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    code: str = Field(..., min_length=1, max_length=20_000)


class MapQueryResponse(BaseModel):
    """Most probable full joint assignment consistent with the given
    evidence, plus that assignment's own joint probability."""

    assignment: dict[str, str]
    probability: float


EstimatorKind = Literal["mle", "bayesian"]
PriorType = Literal["BDeu", "dirichlet", "K2"]


class LearnParametersRequest(BaseModel):
    """Fits CPTs for `nodes` (states/parents from the current network; `cpt`
    values are ignored and may be placeholders) from an uploaded CSV."""

    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    csv_content: str = Field(..., min_length=1)
    # node id -> CSV column name; only nodes present here are (re-)fit.
    column_mapping: dict[str, str] = Field(..., min_length=1)
    estimator: EstimatorKind = "mle"
    prior_type: PriorType = "BDeu"
    equivalent_sample_size: float = Field(default=5.0, gt=0)


class LearnedCpt(BaseModel):
    node_id: str
    cpt: list[list[float]]
    # Column indices (into `cpt`, same order as the frontend's parent-state
    # cartesian product) where the training data had zero rows for that
    # parent combination -- MLE silently falls back to uniform there, which
    # looks confident but isn't.
    sparse_columns: list[int] = Field(default_factory=list)


class LearnParametersResponse(BaseModel):
    cpts: list[LearnedCpt]
    row_count: int
    warnings: list[str] = Field(default_factory=list)


StructureAlgorithm = Literal["hillclimb", "pc", "treesearch"]
ScoringMethod = Literal["bic", "k2", "bdeu"]


class StructureLearnRequest(BaseModel):
    csv_content: str = Field(..., min_length=1)
    algorithm: StructureAlgorithm = "hillclimb"
    scoring_method: ScoringMethod = "bic"
    required_edges: list[tuple[str, str]] = Field(default_factory=list)
    forbidden_edges: list[tuple[str, str]] = Field(default_factory=list)


class StructureLearnResponse(BaseModel):
    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    warnings: list[str] = Field(default_factory=list)


class IndependenceRequest(BaseModel):
    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    node_a: str
    node_b: str
    observed: list[str] = Field(default_factory=list)


class IndependenceResponse(BaseModel):
    d_separated: bool
    formal: str
    explanation: str


class MarkovBlanketRequest(BaseModel):
    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    node: str


class MarkovBlanketResponse(BaseModel):
    parents: list[str]
    children: list[str]
    spouses: list[str]


class SimulateRequest(BaseModel):
    nodes: list[NodeDefinition]
    edges: list[tuple[str, str]]
    n_samples: int = Field(default=1000, ge=1, le=200_000)
    do: dict[str, str] = Field(default_factory=dict)
    evidence: dict[str, str] = Field(default_factory=dict)
    seed: int | None = None


class SimulateResponse(BaseModel):
    csv_content: str
    row_count: int
