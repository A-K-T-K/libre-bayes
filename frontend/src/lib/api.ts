import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

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

// Relative fetches (`fetch("/api/...")`) only reach the backend under the
// Vite dev server, which proxies `/api` to it (see vite.config.ts). The
// packaged Tauri app has no such proxy -- its webview is served from
// `tauri://localhost` (or `https://tauri.localhost` on Windows), a
// different origin than the FastAPI backend the Rust side spawns on
// `http://127.0.0.1:8000` (see `spawn_backend` in src-tauri/src/main.rs).
// `import.meta.env.DEV` is true only under the dev server, so this resolves
// to the real backend origin everywhere else (release build, `tauri dev`
// with a built frontend, etc).
const API_BASE = import.meta.env.DEV ? "" : "http://127.0.0.1:8000";

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// The packaged app's webview origin (`tauri://localhost`, or
// `https://tauri.localhost` on Windows -- WebView2 requires https for its
// custom protocol) treats a plain `http://127.0.0.1:8000` request as mixed
// content and silently blocks it, exactly like a browser would on an https
// page -- this is what actually caused every request to fail with a bare
// "inference request failed" even after pointing them at the right origin
// above. `@tauri-apps/plugin-http`'s `fetch` is a drop-in replacement that
// makes the request from the Rust side (via IPC) instead of the webview's
// own network stack, which isn't subject to that restriction; it's only
// usable inside an actual Tauri window, so plain browser dev mode keeps
// using the real `fetch`.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const platformFetch: typeof fetch = isTauri ? (tauriFetch as unknown as typeof fetch) : fetch;

async function readErrorDetail(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return body.detail ?? res.statusText;
}

/** Retries a fetch a few times on connection-level failures (the backend
 * process can still be starting up when the window first opens) -- but
 * never retries an HTTP error response, which is a real answer from the
 * server, not a transient failure. */
async function fetchWithRetry(input: string, init?: RequestInit, attempts = 5): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await platformFetch(input, init);
    } catch (err) {
      if (init?.signal?.aborted || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

/** Every currently-registered inference solver (built-in and plugins). */
export async function fetchSolvers(): Promise<SolverDescriptor[]> {
  const res = await fetchWithRetry(apiUrl("/api/solvers"));
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
  const res = await platformFetch(apiUrl("/api/solvers/custom"), {
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
  const res = await fetchWithRetry(apiUrl("/api/infer"), {
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
  const res = await fetchWithRetry(apiUrl(path), {
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
  const res = await platformFetch(apiUrl(`/api/export/${format}`), {
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
  const res = await platformFetch(apiUrl(`/api/import/${format}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorDetail(res));
  }

  return (await res.json()) as NetworkPayload;
}
