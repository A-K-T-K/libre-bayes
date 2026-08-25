import type {
  CustomSolverRequest,
  IndependenceRequest,
  IndependenceResponse,
  InferenceResponse,
  LearnParametersRequest,
  LearnParametersResponse,
  MapQueryResponse,
  MarkovBlanketRequest,
  MarkovBlanketResponse,
  NetworkFileFormat,
  NetworkPayload,
  SimulateRequest,
  SimulateResponse,
  SolverDescriptor,
  StructureLearnRequest,
  StructureLearnResponse,
  TemporalInferenceResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readErrorDetail(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return body.detail ?? res.statusText;
}

/** Every currently-registered inference solver (built-in and plugins). */
export async function fetchSolvers(): Promise<SolverDescriptor[]> {
  const res = await fetch("/api/solvers");
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }
  return (await res.json()) as SolverDescriptor[];
}

/** Registers a user-authored solver plugin (see backend/solvers/SCHEMA.md);
 * returns the updated solver list on success. */
export async function registerCustomSolver(
  request: CustomSolverRequest,
): Promise<SolverDescriptor[]> {
  const res = await fetch("/api/solvers/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }
  return (await res.json()) as SolverDescriptor[];
}

export async function runInference(
  payload: NetworkPayload,
  signal?: AbortSignal,
): Promise<InferenceResponse> {
  const res = await fetch("/api/infer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }

  return (await res.json()) as InferenceResponse;
}

/** Every node's marginal at every unrolled Dynamic BN time slice. Always
 * exact (Variable Elimination) regardless of the selected solver -- see
 * `run_temporal_inference`'s docstring in backend/engine.py. */
export function runTemporalInference(payload: NetworkPayload): Promise<TemporalInferenceResponse> {
  return postJson("/api/infer/temporal", payload);
}

async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }
  return (await res.json()) as TResponse;
}

/** Most probable full joint assignment consistent with the given evidence. */
export function mapQuery(payload: NetworkPayload): Promise<MapQueryResponse> {
  return postJson("/api/infer/map", payload);
}

/** Fits CPTs for the mapped nodes from an uploaded CSV (MLE or Bayesian). */
export function learnParameters(req: LearnParametersRequest): Promise<LearnParametersResponse> {
  return postJson("/api/learn/parameters", req);
}

/** Discovers a DAG structure from data (Hill Climb / PC / Tree Search). */
export function learnStructure(req: StructureLearnRequest): Promise<StructureLearnResponse> {
  return postJson("/api/structure/learn", req);
}

/** d-separation between two nodes given an observed set. */
export function queryIndependence(req: IndependenceRequest): Promise<IndependenceResponse> {
  return postJson("/api/explain/independence", req);
}

/** A node's Markov blanket: parents, children, and co-parents (spouses). */
export function queryMarkovBlanket(req: MarkovBlanketRequest): Promise<MarkovBlanketResponse> {
  return postJson("/api/explain/markov-blanket", req);
}

/** Forward (or interventional, via `do`) sampling -- returns CSV text. */
export function simulate(req: SimulateRequest): Promise<SimulateResponse> {
  return postJson("/api/simulate", req);
}

/** Converts a network to BIF/NET/XDSL/DSC source text via the backend. */
export async function exportNetworkFile(
  payload: NetworkPayload,
  format: Exclude<NetworkFileFormat, "json">,
): Promise<string> {
  const res = await fetch(`/api/export/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }

  return await res.text();
}

/** Parses BIF/NET/XDSL/DSC source text into a NetworkPayload via the backend. */
export async function importNetworkFile(
  content: string,
  format: Exclude<NetworkFileFormat, "json">,
): Promise<NetworkPayload> {
  const res = await fetch(`/api/import/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }

  return (await res.json()) as NetworkPayload;
}
