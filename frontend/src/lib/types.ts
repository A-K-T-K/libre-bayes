/**
 * Unified Polymorphic JSON Schema — must stay in lock-step with
 * `backend/schema.py`. This is the single contract the frontend and
 * backend communicate through.
 */

// A plain string, not a fixed union: the set of valid values is whatever the
// backend currently has registered in `solver_registry` (see
// `backend/solvers/_template.py`), fetched at runtime via `/api/solvers` --
// a new solver plugin needs no frontend changes to show up.
export type InferenceMethod = string;

export type InferenceBackend = "numpy" | "torch";

/** One inference solver as advertised by `GET /api/solvers`. */
export interface SolverDescriptor {
  name: string;
  label: string;
  description: string;
  supports_sampling: boolean;
}

/** Submitted to `POST /api/solvers/custom` -- see backend/solvers/SCHEMA.md
 * for the full contract `code` must follow. */
export interface CustomSolverRequest {
  name: string;
  label: string;
  description: string;
  code: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

export type NodeDisplayMode = "circle" | "bar";

export interface NodeDefinition {
  /** Stable, unique identifier -- auto-allocated (e.g. "Node1") but
   * user-editable. Used as the key for edges, CPT parent references, and
   * evidence, so renaming it rewires those automatically. */
  id: string;
  /** Optional free-form display label shown on canvas instead of `id`.
   * Purely cosmetic -- doesn't need to be unique and never touches edges/
   * CPT references. Frontend-only; ignored by the backend. */
  name?: string;
  states: string[];
  /** rows = this node's states, columns = Cartesian product of parent states */
  cpt: number[][];
  parents: string[];
  position?: Position;
  /** Frontend-only visual size for user-drawn/resized nodes; ignored by the backend. */
  size?: NodeSize;
  /** Frontend-only visual style (circle vs. mini bar chart); ignored by the backend. */
  displayMode?: NodeDisplayMode;
  /** Marks this node as persisting across Dynamic BN time slices -- an
   * implied (node, t-1) -> (node, t) edge, not listed in `parents`/edges.
   * When true, `transition_cpt` is this node's CPD for every slice after the
   * first (conditioned on its own previous-slice value plus its ordinary
   * parents); `cpt` remains its slice-0 ("initial state") CPD. */
  temporal?: boolean;
  transition_cpt?: number[][];
}

/** One soft/likelihood constraint on a node at a specific Dynamic BN time
 * slice -- unlike hard evidence (`X = state`), this reweights belief via
 * Jeffrey's rule without asserting certainty. Values needn't sum to 1 (a
 * likelihood ratio, not a probability), matching what pgmpy's
 * `virtual_evidence` expects. Wire field names mirror the backend's
 * `VirtualEvidenceEntry` (snake_case, like the rest of NetworkPayload). */
export interface VirtualEvidenceEntry {
  node_id: string;
  time_slice: number;
  distribution: Record<string, number>;
}

export interface InferenceOptions {
  method: InferenceMethod;
  n_samples?: number;
  backend: InferenceBackend;
}

export interface NetworkPayload {
  nodes: NodeDefinition[];
  edges: [string, string][];
  evidence: Record<string, string>;
  /** Causal do()-interventions, distinct from `evidence` (observation) --
   * see backend/schema.py's NetworkPayload docstring for the semantics. */
  interventions?: Record<string, string>;
  options: InferenceOptions;
  /** Dynamic-BN fields -- no-ops for the static `/api/infer`/`/api/infer/map`
   * endpoints (which only ever see slice 0), used by `/api/infer/temporal`.
   * `evidence`/`interventions` above are always slice-0 (initial state);
   * per-slice soft constraints go through `virtual_evidence` instead. */
  dbn_time_slices?: number;
  virtual_evidence?: VirtualEvidenceEntry[];
}

/** Result of `POST /api/infer/map` -- the single most probable full joint
 * assignment consistent with the given evidence. */
export interface MapQueryResponse {
  assignment: Record<string, string>;
  probability: number;
}

export type Estimator = "mle" | "bayesian";
export type PriorType = "BDeu" | "dirichlet" | "K2";

export interface LearnParametersRequest {
  nodes: NodeDefinition[];
  edges: [string, string][];
  csv_content: string;
  column_mapping: Record<string, string>;
  estimator: Estimator;
  prior_type?: PriorType;
  equivalent_sample_size?: number;
}

export interface LearnedCpt {
  node_id: string;
  cpt: number[][];
  sparse_columns: number[];
}

export interface LearnParametersResponse {
  cpts: LearnedCpt[];
  row_count: number;
  warnings: string[];
}

export type StructureAlgorithm = "hillclimb" | "pc" | "treesearch";
export type ScoringMethod = "bic" | "k2" | "bdeu";

export interface StructureLearnRequest {
  csv_content: string;
  algorithm: StructureAlgorithm;
  scoring_method?: ScoringMethod;
  required_edges?: [string, string][];
  forbidden_edges?: [string, string][];
}

export interface StructureLearnResponse {
  nodes: NodeDefinition[];
  edges: [string, string][];
  warnings: string[];
}

export interface IndependenceRequest {
  nodes: NodeDefinition[];
  edges: [string, string][];
  node_a: string;
  node_b: string;
  observed: string[];
}

export interface IndependenceResponse {
  d_separated: boolean;
  formal: string;
  explanation: string;
}

export interface MarkovBlanketRequest {
  nodes: NodeDefinition[];
  edges: [string, string][];
  node: string;
}

export interface MarkovBlanketResponse {
  parents: string[];
  children: string[];
  spouses: string[];
}

export interface SimulateRequest {
  nodes: NodeDefinition[];
  edges: [string, string][];
  n_samples: number;
  do?: Record<string, string>;
  evidence?: Record<string, string>;
  seed?: number;
}

export interface SimulateResponse {
  csv_content: string;
  row_count: number;
}

/** Global operational mode -- what clicking a node/state means changes with
 * it: Design edits structure/CPTs, Observation pins evidence, Intervention
 * performs a do()-surgery instead. */
export type AppMode = "design" | "observe" | "intervene";

export interface InferenceResponse {
  marginals: Record<string, Record<string, number>>;
  latency_ms: number;
  method_used: string;
  warnings: string[];
}

/** Every node's marginal at every unrolled Dynamic BN time slice -- keyed
 * node_id -> time_slice (as a decimal string, since JSON object keys are
 * always strings) -> state -> probability. */
export interface TemporalInferenceResponse {
  marginals: Record<string, Record<string, Record<string, number>>>;
  latency_ms: number;
  warnings: string[];
}

/** Short badge text derived from a solver's label (e.g. "Exact: Variable
 * Elimination" -> "VE"), so the diagnostics badge stays compact without a
 * hardcoded per-solver map that a plugin would need to extend. */
export function shortSolverLabel(label: string): string {
  const afterColon = label.includes(":") ? label.split(":").pop()!.trim() : label;
  const words = afterColon.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    const word = words[0] ?? afterColon;
    return word.length <= 8 ? word : word.slice(0, 8);
  }
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export type NetworkFileFormat = "json" | "bif" | "net" | "xdsl" | "dsc";

export const FILE_FORMAT_LABELS: Record<NetworkFileFormat, string> = {
  json: "JSON",
  bif: "BIF (Bayesian Interchange Format)",
  net: "NET (Hugin)",
  xdsl: "XDSL (GeNIe/SMILE)",
  dsc: "DSC",
};

export const FILE_FORMAT_EXTENSIONS: Record<NetworkFileFormat, string> = {
  json: "json",
  bif: "bif",
  net: "net",
  xdsl: "xdsl",
  dsc: "dsc",
};
