# Data Contract

Frontend and backend communicate through one polymorphic JSON schema, kept in lock-step between
[`backend/schema.py`](https://github.com/A-K-T-K/libre-bayes/blob/main/backend/schema.py) (Pydantic v2) and
[`frontend/src/lib/types.ts`](https://github.com/A-K-T-K/libre-bayes/blob/main/frontend/src/lib/types.ts). Field
names cross the wire verbatim (snake_case, matching the Python side) rather than being translated per side.

## `NodeDefinition`

```ts
interface NodeDefinition {
  id: string;                    // stable identifier -- used by edges, CPT refs, evidence
  states: string[];               // must have >= 2, unique
  cpt: number[][];                 // rows = own states; columns = parent-state Cartesian product
  parents: string[];
  position?: { x: number; y: number };
  size?: { width: number; height: number };   // frontend-only
  displayMode?: "circle" | "bar";              // frontend-only
  temporal?: boolean;                          // Dynamic BN: persists across time slices
  transition_cpt?: number[][];                 // required if temporal -- see below
}
```

`cpt` columns are the Cartesian product of parent states **in declared-parent order, with the last-listed parent's
states cycling fastest** -- this matches pgmpy's own `TabularCPD` column convention exactly, so no reordering is
needed when the backend builds the model. A `transition_cpt` follows the identical rule, treating the node's own
previous-slice value as an implicit *leading* parent (i.e. the slowest-cycling column group).

## `NetworkPayload`

```ts
interface NetworkPayload {
  nodes: NodeDefinition[];
  edges: [string, string][];
  evidence: Record<string, string>;            // hard evidence, always slice 0
  interventions?: Record<string, string>;       // do()-interventions, always slice 0
  options: { method: string; n_samples?: number; backend: "numpy" | "torch" };
  dbn_time_slices?: number;                     // Dynamic BN only
  virtual_evidence?: VirtualEvidenceEntry[];     // Dynamic BN only
}

interface VirtualEvidenceEntry {
  node_id: string;
  time_slice: number;
  distribution: Record<string, number>;         // per-state likelihood, needn't sum to 1
}
```

A node can never appear in both `evidence` and `interventions` at once -- the backend rejects that payload outright.

## Responses

```ts
interface InferenceResponse {
  marginals: Record<string, Record<string, number>>;
  latency_ms: number;
  method_used: string;
  warnings: string[];
}

interface TemporalInferenceResponse {
  marginals: Record<string, Record<string, Record<string, number>>>;  // node -> slice -> state -> probability
  latency_ms: number;
  warnings: string[];
}
```

Note that a `TemporalInferenceResponse`'s middle key (`slice`) arrives as a JSON string, since JSON object keys are
always strings -- convert it back to a number on the way in.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/infer` | Static marginal inference |
| `POST /api/infer/map` | MAP query (always exact) |
| `POST /api/infer/temporal` | Dynamic BN marginal inference, every unrolled time slice |
| `POST /api/learn/parameters` | CPT fitting from CSV |
| `POST /api/structure/learn` | Structure discovery from CSV |
| `POST /api/explain/independence` | d-separation check |
| `POST /api/explain/markov-blanket` | Markov blanket query |
| `POST /api/simulate` | Forward/interventional sampling to CSV |
| `POST /api/export/{fmt}` / `POST /api/import/{fmt}` | BIF / NET / XDSL / DSC |
| `GET /api/solvers` | Every currently-registered inference solver |
| `POST /api/solvers/custom` | Register a new solver plugin live |
