import { create, useStore } from "zustand";
import { shallow } from "zustand/shallow";
import { temporal, type TemporalState } from "zundo";

import { ApiError, fetchSolvers, mapQuery, runInference, runTemporalInference } from "../lib/api";
import { emptyCpt, resizeCptForParents } from "../lib/cpt";
import { autoLayout } from "../lib/layout";
import { getEffectiveSize } from "../lib/nodeGeometry";
import type {
  AppMode,
  InferenceOptions,
  NetworkPayload,
  NodeDefinition,
  NodeDisplayMode,
  NodeSize,
  Position,
  SolverDescriptor,
  VirtualEvidenceEntry,
} from "../lib/types";

const DEBOUNCE_MS = 250;

export type CanvasTool = "select" | "node" | "link";
export type AlignMode = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";
export type DistributeAxis = "horizontal" | "vertical";

function seedNetwork(): Record<string, NodeDefinition> {
  const cloudy: NodeDefinition = {
    id: "Cloudy",
    states: ["True", "False"],
    cpt: [[0.5], [0.5]],
    parents: [],
    position: { x: 260, y: 20 },
  };
  const sprinkler: NodeDefinition = {
    id: "Sprinkler",
    states: ["True", "False"],
    cpt: [
      [0.1, 0.5],
      [0.9, 0.5],
    ],
    parents: ["Cloudy"],
    position: { x: 60, y: 200 },
  };
  const rain: NodeDefinition = {
    id: "Rain",
    states: ["True", "False"],
    cpt: [
      [0.8, 0.2],
      [0.2, 0.8],
    ],
    parents: ["Cloudy"],
    position: { x: 460, y: 200 },
  };
  const wetGrass: NodeDefinition = {
    id: "WetGrass",
    states: ["True", "False"],
    cpt: [
      [0.99, 0.9, 0.9, 0.0],
      [0.01, 0.1, 0.1, 1.0],
    ],
    parents: ["Sprinkler", "Rain"],
    position: { x: 260, y: 380 },
  };
  return {
    Cloudy: cloudy,
    Sprinkler: sprinkler,
    Rain: rain,
    WetGrass: wetGrass,
  };
}

function seedEdges(): [string, string][] {
  return [
    ["Cloudy", "Sprinkler"],
    ["Cloudy", "Rain"],
    ["Sprinkler", "WetGrass"],
    ["Rain", "WetGrass"],
  ];
}

/** Whether adding an edge source->target would create a cycle, i.e. whether
 * `target` can already reach `source` through existing edges. Bayesian
 * networks must stay acyclic. */
function wouldCreateCycle(edges: [string, string][], source: string, target: string): boolean {
  if (source === target) return true;
  const stack = [target];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const [from, to] of edges) {
      if (from === current) stack.push(to);
    }
  }
  return false;
}

/** The `parents` list a temporal node's *transition* CPD is conditioned on:
 * its own previous-slice value (always first) followed by its ordinary
 * (current-slice) parents -- matches the evidence order `engine.
 * _unroll_temporal_network` expects on the backend, and lets the transition
 * grid reuse `CptTable`/`resizeCptForParents` unchanged by treating "self,
 * one slice back" as just another parent. */
export function transitionParents(
  node: Pick<NodeDefinition, "id" | "states" | "parents">,
  nodeDefs: Record<string, NodeDefinition>,
): NodeDefinition[] {
  const selfPrev: NodeDefinition = {
    id: `${node.id} (t-1)`,
    states: node.states,
    cpt: [],
    parents: [],
  };
  return [selfPrev, ...node.parents.map((p) => nodeDefs[p]).filter(Boolean)];
}

function resizeTransitionCpt(node: NodeDefinition, nodeDefs: Record<string, NodeDefinition>): number[][] {
  return resizeCptForParents(node.transition_cpt ?? [], node.states.length, transitionParents(node, nodeDefs));
}

let nextNodeIndex = 1;

interface NetworkState {
  nodeDefs: Record<string, NodeDefinition>;
  edges: [string, string][];
  evidence: Record<string, string>;
  /** Causal do()-interventions -- see NetworkPayload's docstring in
   * lib/types.ts. A node is never in both `evidence` and `interventions`
   * at once. */
  interventions: Record<string, string>;
  mode: AppMode;
  options: InferenceOptions;
  marginals: Record<string, Record<string, number>>;
  latencyMs: number | null;
  methodUsed: string | null;
  warnings: string[];
  isInferring: boolean;
  inferError: string | null;
  /** Most probable full joint assignment (MAP / "most likely scenario"),
   * null until `runMapQuery` succeeds; cleared on any structural or
   * evidence/intervention change so a stale answer never lingers. */
  mapAssignment: Record<string, string> | null;
  mapProbability: number | null;
  isMapQuerying: boolean;
  mapError: string | null;
  selectedNodeId: string | null;
  /** Full multi-selection set for canvas alignment/distribution -- kept in
   * sync with `selectedNodeId` (which mirrors it when exactly one node is
   * selected, and is null when zero or several are, so the single-node
   * inspector and the multi-select alignment toolbar never show at once). */
  selectedNodeIds: string[];
  theme: "light" | "dark";
  showMinimap: boolean;
  showNodePanel: boolean;
  tool: CanvasTool;
  autoInfer: boolean;
  projectName: string;
  solvers: SolverDescriptor[];

  /** Dynamic BN mode -- gates the per-node "Enable Temporal" context menu
   * item; `timeSlices` is how far the network gets unrolled for temporal
   * inference/the Inspector's trajectory plot. */
  dbnEnabled: boolean;
  timeSlices: number;
  /** node_id -> time_slice -> distribution, one entry per (node, slice) --
   * setting a new one for an existing (node, slice) pair replaces it rather
   * than stacking (see `setVirtualEvidence`). */
  virtualEvidence: Record<string, Record<number, Record<string, number>>>;
  /** node_id -> time_slice -> state -> probability, from the last
   * successful `/api/infer/temporal` call. */
  temporalMarginals: Record<string, Record<number, Record<string, number>>>;
  isTemporalInferring: boolean;
  temporalError: string | null;
  temporalWarnings: string[];

  setProjectName: (name: string) => void;
  loadSolvers: () => void;
  setSolvers: (solvers: SolverDescriptor[]) => void;
  addNode: () => void;
  addNodeAt: (position: Position, size?: NodeSize) => void;
  removeNode: (id: string) => void;
  renameNode: (oldId: string, newId: string) => void;
  setNodeName: (id: string, name: string) => void;
  updateNodeStates: (id: string, states: string[]) => void;
  renameNodeState: (id: string, oldState: string, newState: string) => void;
  updateNodeCpt: (id: string, cpt: number[][]) => void;
  updateNodePosition: (id: string, position: Position) => void;
  updateNodeSize: (id: string, size: NodeSize) => void;
  setNodeDisplayMode: (id: string, mode: NodeDisplayMode) => void;
  /** Applies a display mode to every id given in one update -- used so
   * picking "Show as bar chart" while several nodes are selected switches
   * all of them, not just the one that was right-clicked. */
  setNodeDisplayModeMany: (ids: string[], mode: NodeDisplayMode) => void;
  addEdge: (source: string, target: string) => void;
  removeEdge: (source: string, target: string) => void;
  toggleEvidence: (nodeId: string, state: string) => void;
  clearEvidence: () => void;
  toggleIntervention: (nodeId: string, state: string) => void;
  clearInterventions: () => void;
  setMode: (mode: AppMode) => void;
  setOptions: (partial: Partial<InferenceOptions>) => void;
  setSelectedNode: (id: string | null) => void;
  /** Click-driven single-select/toggle entry point for canvas nodes.
   * `toggle: true` (Ctrl/Cmd/Shift-click) adds/removes `id` from the
   * existing multi-selection instead of replacing it. */
  selectNode: (id: string, opts?: { toggle?: boolean }) => void;
  /** Replaces (or, with `additive`, unions into) the multi-selection --
   * used by marquee/rubber-band drag selection. */
  setSelectionIds: (ids: string[], opts?: { additive?: boolean }) => void;
  clearSelection: () => void;
  alignNodes: (mode: AlignMode) => void;
  distributeNodes: (axis: DistributeAxis) => void;
  equalizeSize: () => void;
  setTheme: (theme: "light" | "dark") => void;
  applyAutoLayout: () => void;
  resetCanvas: () => void;
  toggleMinimap: () => void;
  toggleNodePanel: () => void;
  loadNetwork: (payload: NetworkPayload) => void;
  setTool: (tool: CanvasTool) => void;
  setAutoInfer: (enabled: boolean) => void;
  scheduleInference: () => void;
  inferNow: () => void;
  stopInference: () => void;
  runMapQuery: () => void;
  clearMapResult: () => void;

  setDbnEnabled: (enabled: boolean) => void;
  setTimeSlices: (n: number) => void;
  /** Toggling a node temporal on initializes `transition_cpt` (uniform,
   * sized for its states x [own-previous-state x parents]); toggling off
   * clears it and drops any virtual evidence set on that node, since the
   * Inspector's temporal section (where virtual evidence lives) disappears
   * along with it. */
  setNodeTemporal: (id: string, temporal: boolean) => void;
  updateNodeTransitionCpt: (id: string, cpt: number[][]) => void;
  /** Sets (replacing, not stacking) the virtual evidence for one (node,
   * time slice) pair -- see `NetworkState.virtualEvidence`. */
  setVirtualEvidence: (nodeId: string, timeSlice: number, distribution: Record<string, number>) => void;
  removeVirtualEvidence: (nodeId: string, timeSlice: number) => void;
  scheduleTemporalInference: () => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inflightController: AbortController | null = null;
let temporalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// `postJson` (and so `runTemporalInference`) doesn't take an AbortSignal, so
// staleness is tracked with a generation counter instead of an
// AbortController -- a superseded response is just dropped on arrival.
let temporalRequestId = 0;

/** The slice of state that counts as "the network" for undo/redo purposes --
 * excludes ephemeral UI/view state (selection, tool, theme, panel
 * visibility, in-flight inference results) so Ctrl+Z steps through actual
 * edits a user made, not incidental clicks. */
interface UndoableState {
  nodeDefs: Record<string, NodeDefinition>;
  edges: [string, string][];
  evidence: Record<string, string>;
  interventions: Record<string, string>;
  options: InferenceOptions;
  projectName: string;
  dbnEnabled: boolean;
  timeSlices: number;
  virtualEvidence: Record<string, Record<number, Record<string, number>>>;
}

export const useNetworkStore = create<NetworkState>()(
  temporal(
    (set, get) => ({
  nodeDefs: seedNetwork(),
  edges: seedEdges(),
  evidence: {},
  interventions: {},
  mode: "design",
  options: { method: "variable_elimination", n_samples: 10_000, backend: "numpy" },
  marginals: {},
  latencyMs: null,
  methodUsed: null,
  warnings: [],
  isInferring: false,
  inferError: null,
  mapAssignment: null,
  mapProbability: null,
  isMapQuerying: false,
  mapError: null,
  selectedNodeId: null,
  selectedNodeIds: [],
  theme: "light",
  showMinimap: true,
  showNodePanel: true,
  tool: "select",
  autoInfer: true,
  projectName: "Untitled Network",
  solvers: [],

  dbnEnabled: false,
  timeSlices: 2,
  virtualEvidence: {},
  temporalMarginals: {},
  isTemporalInferring: false,
  temporalError: null,
  temporalWarnings: [],

  setProjectName: (name) => set({ projectName: name.trim() || "Untitled Network" }),

  setSolvers: (solvers) => set({ solvers }),

  loadSolvers: () => {
    // On a fresh launch the Tauri sidecar's backend can still be a few
    // hundred ms from listening when this first fires (the frontend and
    // backend start racing each other), which previously left the
    // algorithm dropdown permanently empty for the whole session on any
    // request that lost that race -- retry with backoff instead of a
    // single best-effort attempt.
    const attempt = (retriesLeft: number, delayMs: number) => {
      fetchSolvers()
        .then((solvers) => set({ solvers }))
        .catch(() => {
          if (retriesLeft <= 0) return;
          setTimeout(() => attempt(retriesLeft - 1, Math.min(delayMs * 2, 2000)), delayMs);
        });
    };
    attempt(8, 250);
  },

  addNode: () => {
    let id = `Node${nextNodeIndex}`;
    while (get().nodeDefs[id]) {
      nextNodeIndex += 1;
      id = `Node${nextNodeIndex}`;
    }
    nextNodeIndex += 1;
    const node: NodeDefinition = {
      id,
      states: ["True", "False"],
      cpt: emptyCpt(2, 1),
      parents: [],
      position: { x: 120 + Math.random() * 320, y: 120 + Math.random() * 240 },
    };
    set((s) => ({ nodeDefs: { ...s.nodeDefs, [id]: node } }));
    get().scheduleInference();
  },

  addNodeAt: (position, size) => {
    let id = `Node${nextNodeIndex}`;
    while (get().nodeDefs[id]) {
      nextNodeIndex += 1;
      id = `Node${nextNodeIndex}`;
    }
    nextNodeIndex += 1;
    const node: NodeDefinition = {
      id,
      states: ["True", "False"],
      cpt: emptyCpt(2, 1),
      parents: [],
      position,
      size,
    };
    set((s) => ({ nodeDefs: { ...s.nodeDefs, [id]: node } }));
    get().scheduleInference();
  },

  removeNode: (id) => {
    set((s) => {
      const nodeDefs = { ...s.nodeDefs };
      delete nodeDefs[id];
      for (const key of Object.keys(nodeDefs)) {
        if (nodeDefs[key].parents.includes(id)) {
          const parents = nodeDefs[key].parents.filter((p) => p !== id);
          const updated: NodeDefinition = {
            ...nodeDefs[key],
            parents,
            cpt: resizeCptForParents(nodeDefs[key].cpt, nodeDefs[key].states.length, parents.map((p) => nodeDefs[p])),
          };
          if (updated.temporal) {
            updated.transition_cpt = resizeTransitionCpt(updated, nodeDefs);
          }
          nodeDefs[key] = updated;
        }
      }
      const edges = s.edges.filter(([src, dst]) => src !== id && dst !== id);
      const evidence = { ...s.evidence };
      delete evidence[id];
      const interventions = { ...s.interventions };
      delete interventions[id];
      const virtualEvidence = { ...s.virtualEvidence };
      delete virtualEvidence[id];
      return {
        nodeDefs,
        edges,
        evidence,
        interventions,
        virtualEvidence,
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.filter((n) => n !== id),
      };
    });
    get().scheduleInference();
  },

  renameNode: (oldId, newId) => {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return;
    set((s) => {
      if (s.nodeDefs[trimmed]) return s;
      const nodeDefs: Record<string, NodeDefinition> = {};
      for (const [key, def] of Object.entries(s.nodeDefs)) {
        if (key === oldId) {
          nodeDefs[trimmed] = { ...def, id: trimmed };
        } else {
          nodeDefs[key] = {
            ...def,
            parents: def.parents.map((p) => (p === oldId ? trimmed : p)),
          };
        }
      }
      const edges = s.edges.map(
        ([src, dst]) =>
          [src === oldId ? trimmed : src, dst === oldId ? trimmed : dst] as [
            string,
            string,
          ],
      );
      const evidence = { ...s.evidence };
      if (oldId in evidence) {
        evidence[trimmed] = evidence[oldId];
        delete evidence[oldId];
      }
      const interventions = { ...s.interventions };
      if (oldId in interventions) {
        interventions[trimmed] = interventions[oldId];
        delete interventions[oldId];
      }
      const virtualEvidence = { ...s.virtualEvidence };
      if (oldId in virtualEvidence) {
        virtualEvidence[trimmed] = virtualEvidence[oldId];
        delete virtualEvidence[oldId];
      }
      return {
        nodeDefs,
        edges,
        evidence,
        interventions,
        virtualEvidence,
        selectedNodeId: s.selectedNodeId === oldId ? trimmed : s.selectedNodeId,
        selectedNodeIds: s.selectedNodeIds.map((n) => (n === oldId ? trimmed : n)),
      };
    });
    get().scheduleInference();
  },

  setNodeName: (id, name) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], name: name.trim() || undefined } },
    }));
  },

  updateNodeStates: (id, states) => {
    set((s) => {
      const node = s.nodeDefs[id];
      if (!node) return s;
      const cpt = resizeCptForParents(
        node.cpt,
        states.length,
        node.parents.map((p) => s.nodeDefs[p]),
      );
      const updated = { ...node, states, cpt };
      if (node.temporal) {
        updated.transition_cpt = resizeTransitionCpt(updated, s.nodeDefs);
      }
      const nodeDefs = { ...s.nodeDefs, [id]: updated };
      const evidence = { ...s.evidence };
      if (evidence[id] && !states.includes(evidence[id])) delete evidence[id];
      const interventions = { ...s.interventions };
      if (interventions[id] && !states.includes(interventions[id])) delete interventions[id];
      return { nodeDefs, evidence, interventions };
    });
    get().scheduleInference();
  },

  renameNodeState: (id, oldState, newState) => {
    const trimmed = newState.trim();
    if (!trimmed || trimmed === oldState) return;
    set((s) => {
      const node = s.nodeDefs[id];
      if (!node || !node.states.includes(oldState) || node.states.includes(trimmed)) return s;
      const states = node.states.map((st) => (st === oldState ? trimmed : st));
      const nodeDefs = { ...s.nodeDefs, [id]: { ...node, states } };
      const evidence = { ...s.evidence };
      if (evidence[id] === oldState) evidence[id] = trimmed;
      const interventions = { ...s.interventions };
      if (interventions[id] === oldState) interventions[id] = trimmed;
      return { nodeDefs, evidence, interventions };
    });
    get().scheduleInference();
  },

  updateNodeCpt: (id, cpt) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], cpt } },
    }));
    get().scheduleInference();
  },

  updateNodePosition: (id, position) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], position } },
    }));
  },

  updateNodeSize: (id, size) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], size } },
    }));
  },

  setNodeDisplayMode: (id, mode) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], displayMode: mode } },
    }));
  },

  setNodeDisplayModeMany: (ids, mode) => {
    set((s) => {
      const nodeDefs = { ...s.nodeDefs };
      for (const id of ids) {
        if (nodeDefs[id]) nodeDefs[id] = { ...nodeDefs[id], displayMode: mode };
      }
      return { nodeDefs };
    });
  },

  addEdge: (source, target) => {
    set((s) => {
      if (source === target) return s;
      if (s.edges.some(([a, b]) => a === source && b === target)) return s;
      const targetNode = s.nodeDefs[target];
      if (!targetNode || targetNode.parents.includes(source)) return s;
      if (wouldCreateCycle(s.edges, source, target)) return s;
      const parents = [...targetNode.parents, source];
      const updated: NodeDefinition = {
        ...targetNode,
        parents,
        cpt: resizeCptForParents(
          targetNode.cpt,
          targetNode.states.length,
          parents.map((p) => s.nodeDefs[p]),
        ),
      };
      if (targetNode.temporal) {
        updated.transition_cpt = resizeTransitionCpt(updated, s.nodeDefs);
      }
      const nodeDefs = { ...s.nodeDefs, [target]: updated };
      return { nodeDefs, edges: [...s.edges, [source, target]] };
    });
    get().scheduleInference();
  },

  removeEdge: (source, target) => {
    set((s) => {
      const targetNode = s.nodeDefs[target];
      if (!targetNode) return s;
      const parents = targetNode.parents.filter((p) => p !== source);
      const updated: NodeDefinition = {
        ...targetNode,
        parents,
        cpt: resizeCptForParents(
          targetNode.cpt,
          targetNode.states.length,
          parents.map((p) => s.nodeDefs[p]),
        ),
      };
      if (targetNode.temporal) {
        updated.transition_cpt = resizeTransitionCpt(updated, s.nodeDefs);
      }
      const nodeDefs = { ...s.nodeDefs, [target]: updated };
      const edges = s.edges.filter(([a, b]) => !(a === source && b === target));
      return { nodeDefs, edges };
    });
    get().scheduleInference();
  },

  toggleEvidence: (nodeId, state) => {
    set((s) => {
      const evidence = { ...s.evidence };
      if (evidence[nodeId] === state) {
        delete evidence[nodeId];
      } else {
        evidence[nodeId] = state;
      }
      const interventions = { ...s.interventions };
      delete interventions[nodeId];
      return { evidence, interventions };
    });
    get().scheduleInference();
  },

  clearEvidence: () => {
    set({ evidence: {} });
    get().scheduleInference();
  },

  toggleIntervention: (nodeId, state) => {
    set((s) => {
      const interventions = { ...s.interventions };
      if (interventions[nodeId] === state) {
        delete interventions[nodeId];
      } else {
        interventions[nodeId] = state;
      }
      // A node can't be both observed and intervened on at once (the
      // backend rejects it outright) -- clearing any existing evidence
      // here keeps that true without surprising the user with a rejected
      // request the next time inference runs.
      const evidence = { ...s.evidence };
      delete evidence[nodeId];
      return { interventions, evidence };
    });
    get().scheduleInference();
  },

  clearInterventions: () => {
    set({ interventions: {} });
    get().scheduleInference();
  },

  setMode: (mode) => set({ mode }),

  setOptions: (partial) => {
    set((s) => ({ options: { ...s.options, ...partial } }));
    get().scheduleInference();
  },

  setSelectedNode: (id) => set({ selectedNodeId: id, selectedNodeIds: id ? [id] : [] }),

  selectNode: (id, opts) => {
    set((s) => {
      if (opts?.toggle) {
        const has = s.selectedNodeIds.includes(id);
        const selectedNodeIds = has
          ? s.selectedNodeIds.filter((n) => n !== id)
          : [...s.selectedNodeIds, id];
        return {
          selectedNodeIds,
          selectedNodeId: selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
        };
      }
      return { selectedNodeIds: [id], selectedNodeId: id };
    });
  },

  setSelectionIds: (ids, opts) => {
    set((s) => {
      const merged = opts?.additive ? Array.from(new Set([...s.selectedNodeIds, ...ids])) : ids;
      return {
        selectedNodeIds: merged,
        selectedNodeId: merged.length === 1 ? merged[0] : null,
      };
    });
  },

  clearSelection: () => set({ selectedNodeIds: [], selectedNodeId: null }),

  alignNodes: (mode) => {
    set((s) => {
      const ids = s.selectedNodeIds;
      if (ids.length < 2) return s;
      const rects = ids
        .map((id) => s.nodeDefs[id] && { id, def: s.nodeDefs[id] })
        .filter((r): r is { id: string; def: NodeDefinition } => Boolean(r))
        .map(({ id, def }) => {
          const pos = def.position ?? { x: 0, y: 0 };
          const size = getEffectiveSize(def);
          return { id, x: pos.x, y: pos.y, width: size.width, height: size.height };
        });
      if (rects.length < 2) return s;

      const updates: Record<string, Position> = {};
      switch (mode) {
        case "left": {
          const minX = Math.min(...rects.map((r) => r.x));
          rects.forEach((r) => (updates[r.id] = { x: minX, y: r.y }));
          break;
        }
        case "right": {
          const maxRight = Math.max(...rects.map((r) => r.x + r.width));
          rects.forEach((r) => (updates[r.id] = { x: maxRight - r.width, y: r.y }));
          break;
        }
        case "top": {
          const minY = Math.min(...rects.map((r) => r.y));
          rects.forEach((r) => (updates[r.id] = { x: r.x, y: minY }));
          break;
        }
        case "bottom": {
          const maxBottom = Math.max(...rects.map((r) => r.y + r.height));
          rects.forEach((r) => (updates[r.id] = { x: r.x, y: maxBottom - r.height }));
          break;
        }
        // Sets all selected nodes' y position to the average y coordinate.
        case "centerY": {
          const avgY = rects.reduce((acc, r) => acc + r.y, 0) / rects.length;
          rects.forEach((r) => (updates[r.id] = { x: r.x, y: avgY }));
          break;
        }
        // Sets all selected nodes' x position to the average x coordinate.
        case "centerX": {
          const avgX = rects.reduce((acc, r) => acc + r.x, 0) / rects.length;
          rects.forEach((r) => (updates[r.id] = { x: avgX, y: r.y }));
          break;
        }
      }

      const nodeDefs = { ...s.nodeDefs };
      for (const [id, position] of Object.entries(updates)) {
        nodeDefs[id] = { ...nodeDefs[id], position };
      }
      return { nodeDefs };
    });
  },

  distributeNodes: (axis) => {
    set((s) => {
      const ids = s.selectedNodeIds;
      if (ids.length < 3) return s;
      const items = ids
        .map((id) => s.nodeDefs[id] && { id, def: s.nodeDefs[id] })
        .filter((r): r is { id: string; def: NodeDefinition } => Boolean(r))
        .map(({ id, def }) => {
          const pos = def.position ?? { x: 0, y: 0 };
          const size = getEffectiveSize(def);
          return { id, x: pos.x, y: pos.y, width: size.width, height: size.height };
        });
      if (items.length < 3) return s;

      const nodeDefs = { ...s.nodeDefs };
      if (axis === "horizontal") {
        items.sort((a, b) => a.x - b.x);
        const first = items[0];
        const last = items[items.length - 1];
        const sumWidths = items.reduce((acc, it) => acc + it.width, 0);
        const gap = (last.x + last.width - first.x - sumWidths) / (items.length - 1);
        let cursor = first.x;
        items.forEach((it, i) => {
          const x = i === items.length - 1 ? last.x : cursor;
          nodeDefs[it.id] = { ...nodeDefs[it.id], position: { x, y: it.y } };
          cursor += it.width + gap;
        });
      } else {
        items.sort((a, b) => a.y - b.y);
        const first = items[0];
        const last = items[items.length - 1];
        const sumHeights = items.reduce((acc, it) => acc + it.height, 0);
        const gap = (last.y + last.height - first.y - sumHeights) / (items.length - 1);
        let cursor = first.y;
        items.forEach((it, i) => {
          const y = i === items.length - 1 ? last.y : cursor;
          nodeDefs[it.id] = { ...nodeDefs[it.id], position: { x: it.x, y } };
          cursor += it.height + gap;
        });
      }
      return { nodeDefs };
    });
  },

  // Every selected node grows/shrinks to the largest width and largest
  // height among the selection (independently) -- taking the max rather
  // than, say, the first-selected node's size means nothing ever needs to
  // clip its label/bars to fit, whichever node happened to be biggest to
  // start with. Each node's *center* stays fixed while it resizes (not its
  // top-left corner), so nodes don't visibly jump sideways/down as they
  // grow -- purely a size change, not a reposition.
  equalizeSize: () => {
    set((s) => {
      const ids = s.selectedNodeIds;
      if (ids.length < 2) return s;
      const items = ids
        .map((id) => s.nodeDefs[id] && { id, def: s.nodeDefs[id] })
        .filter((r): r is { id: string; def: NodeDefinition } => Boolean(r))
        .map(({ id, def }) => {
          const pos = def.position ?? { x: 0, y: 0 };
          const size = getEffectiveSize(def);
          return { id, x: pos.x, y: pos.y, width: size.width, height: size.height };
        });
      if (items.length < 2) return s;

      const targetWidth = Math.max(...items.map((it) => it.width));
      const targetHeight = Math.max(...items.map((it) => it.height));

      const nodeDefs = { ...s.nodeDefs };
      for (const it of items) {
        const centerX = it.x + it.width / 2;
        const centerY = it.y + it.height / 2;
        nodeDefs[it.id] = {
          ...nodeDefs[it.id],
          size: { width: targetWidth, height: targetHeight },
          position: { x: centerX - targetWidth / 2, y: centerY - targetHeight / 2 },
        };
      }
      return { nodeDefs };
    });
  },

  setTheme: (theme) => set({ theme }),

  setTool: (tool) =>
    set((s) => ({
      tool,
      selectedNodeId: tool === "select" ? s.selectedNodeId : null,
      selectedNodeIds: tool === "select" ? s.selectedNodeIds : [],
    })),

  applyAutoLayout: () => {
    set((s) => {
      const layoutInputs = Object.values(s.nodeDefs).map((n) => ({ id: n.id, size: getEffectiveSize(n) }));
      const positions = autoLayout(layoutInputs, s.edges);
      const nodeDefs = { ...s.nodeDefs };
      for (const [id, position] of Object.entries(positions)) {
        nodeDefs[id] = { ...nodeDefs[id], position };
      }
      return { nodeDefs };
    });
  },

  resetCanvas: () => {
    set({
      nodeDefs: seedNetwork(),
      edges: seedEdges(),
      evidence: {},
      interventions: {},
      marginals: {},
      selectedNodeId: null,
      selectedNodeIds: [],
      warnings: [],
      inferError: null,
      projectName: "Untitled Network",
      dbnEnabled: false,
      timeSlices: 2,
      virtualEvidence: {},
      temporalMarginals: {},
      temporalError: null,
      temporalWarnings: [],
    });
    get().scheduleInference();
  },

  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),

  toggleNodePanel: () => set((s) => ({ showNodePanel: !s.showNodePanel })),

  loadNetwork: (payload) => {
    const nodeDefs: Record<string, NodeDefinition> = {};
    for (const node of payload.nodes) {
      nodeDefs[node.id] = node;
    }
    const virtualEvidence: NetworkState["virtualEvidence"] = {};
    for (const entry of payload.virtual_evidence ?? []) {
      virtualEvidence[entry.node_id] = {
        ...virtualEvidence[entry.node_id],
        [entry.time_slice]: entry.distribution,
      };
    }
    set({
      nodeDefs,
      edges: payload.edges,
      evidence: payload.evidence ?? {},
      interventions: payload.interventions ?? {},
      options: payload.options ?? {
        method: "variable_elimination",
        n_samples: 10_000,
        backend: "numpy",
      },
      selectedNodeId: null,
      selectedNodeIds: [],
      warnings: [],
      inferError: null,
      dbnEnabled: payload.nodes.some((n) => n.temporal),
      timeSlices: payload.dbn_time_slices ?? 2,
      virtualEvidence,
      temporalMarginals: {},
      temporalError: null,
      temporalWarnings: [],
    });
    get().scheduleInference();
  },

  setAutoInfer: (enabled) => set({ autoInfer: enabled }),

  scheduleInference: () => {
    // A MAP result answers "most likely scenario for the network as it was
    // when I asked" -- anything that triggers a new inference pass means
    // the network (or its evidence/interventions) just changed, so the old
    // answer is stale the moment it happens, not just once new marginals
    // arrive.
    set({ mapAssignment: null, mapProbability: null, mapError: null });
    get().scheduleTemporalInference();
    if (!get().autoInfer) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runInferenceNow();
    }, DEBOUNCE_MS);
  },

  inferNow: () => {
    set({ mapAssignment: null, mapProbability: null, mapError: null });
    get().scheduleTemporalInference();
    if (debounceTimer) clearTimeout(debounceTimer);
    void runInferenceNow();
  },

  runMapQuery: () => {
    const state = get();
    const nodes = Object.values(state.nodeDefs);
    if (nodes.length === 0) return;
    const payload: NetworkPayload = {
      nodes,
      edges: state.edges,
      evidence: state.evidence,
      interventions: state.interventions,
      options: state.options,
    };
    set({ isMapQuerying: true, mapError: null });
    void mapQuery(payload)
      .then((res) => {
        set({
          mapAssignment: res.assignment,
          mapProbability: res.probability,
          isMapQuerying: false,
        });
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "MAP query failed";
        set({ isMapQuerying: false, mapError: message });
      });
  },

  clearMapResult: () => set({ mapAssignment: null, mapProbability: null, mapError: null }),

  stopInference: () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (inflightController) inflightController.abort();
    set({ isInferring: false, inferError: "Inference cancelled" });
  },

  setDbnEnabled: (enabled) => {
    set({ dbnEnabled: enabled });
    get().scheduleTemporalInference();
  },

  setTimeSlices: (n) => {
    const clamped = Math.min(50, Math.max(1, Math.round(n)));
    set((s) => {
      // Virtual evidence targeting a slice that no longer exists would
      // silently be ignored by the backend (rejected, actually -- see
      // NetworkPayload's validator) -- drop it here instead so the
      // Inspector's list of set entries never shows a stale one.
      const virtualEvidence: typeof s.virtualEvidence = {};
      for (const [nodeId, bySlice] of Object.entries(s.virtualEvidence)) {
        const kept = Object.fromEntries(Object.entries(bySlice).filter(([t]) => Number(t) < clamped));
        if (Object.keys(kept).length > 0) virtualEvidence[nodeId] = kept;
      }
      return { timeSlices: clamped, virtualEvidence };
    });
    get().scheduleTemporalInference();
  },

  setNodeTemporal: (id, temporalFlag) => {
    set((s) => {
      const node = s.nodeDefs[id];
      if (!node || node.temporal === temporalFlag) return s;
      const updated: NodeDefinition = { ...node, temporal: temporalFlag };
      if (temporalFlag) {
        updated.transition_cpt = resizeTransitionCpt(updated, s.nodeDefs);
      } else {
        delete updated.transition_cpt;
      }
      const nodeDefs = { ...s.nodeDefs, [id]: updated };
      const virtualEvidence = { ...s.virtualEvidence };
      if (!temporalFlag) delete virtualEvidence[id];
      return { nodeDefs, virtualEvidence };
    });
    get().scheduleTemporalInference();
  },

  updateNodeTransitionCpt: (id, cpt) => {
    set((s) => ({
      nodeDefs: { ...s.nodeDefs, [id]: { ...s.nodeDefs[id], transition_cpt: cpt } },
    }));
    get().scheduleTemporalInference();
  },

  setVirtualEvidence: (nodeId, timeSlice, distribution) => {
    set((s) => ({
      virtualEvidence: {
        ...s.virtualEvidence,
        [nodeId]: { ...s.virtualEvidence[nodeId], [timeSlice]: distribution },
      },
    }));
    get().scheduleTemporalInference();
  },

  removeVirtualEvidence: (nodeId, timeSlice) => {
    set((s) => {
      const bySlice = { ...s.virtualEvidence[nodeId] };
      delete bySlice[timeSlice];
      const virtualEvidence = { ...s.virtualEvidence };
      if (Object.keys(bySlice).length > 0) virtualEvidence[nodeId] = bySlice;
      else delete virtualEvidence[nodeId];
      return { virtualEvidence };
    });
    get().scheduleTemporalInference();
  },

  scheduleTemporalInference: () => {
    if (temporalDebounceTimer) clearTimeout(temporalDebounceTimer);
    const s = get();
    if (!s.dbnEnabled || !Object.values(s.nodeDefs).some((n) => n.temporal)) {
      set({ temporalMarginals: {}, temporalError: null, temporalWarnings: [] });
      return;
    }
    temporalDebounceTimer = setTimeout(() => {
      void runTemporalInferenceNow();
    }, DEBOUNCE_MS);
  },
    }),
    {
      limit: 100,
      partialize: (state): UndoableState => ({
        nodeDefs: state.nodeDefs,
        edges: state.edges,
        evidence: state.evidence,
        interventions: state.interventions,
        options: state.options,
        projectName: state.projectName,
        dbnEnabled: state.dbnEnabled,
        timeSlices: state.timeSlices,
        virtualEvidence: state.virtualEvidence,
      }),
      // `partialize` builds a fresh wrapper object on every call, so a
      // reference-equality check would treat every state change as a new
      // undo step even when none of these five fields actually changed
      // (e.g. a pure selection or pan/zoom update). Each field keeps its
      // own reference unless our reducers actually touch it, so a shallow
      // compare of the wrapper's top-level keys is the right granularity.
      equality: (a, b) => shallow(a, b),
    },
  ),
);

async function runInferenceNow() {
  const state = useNetworkStore.getState();
  const nodes = Object.values(state.nodeDefs);
  if (nodes.length === 0) {
    useNetworkStore.setState({ marginals: {}, methodUsed: null, latencyMs: null });
    return;
  }

  if (inflightController) inflightController.abort();
  const controller = new AbortController();
  inflightController = controller;

  const payload: NetworkPayload = {
    nodes,
    edges: state.edges,
    evidence: state.evidence,
    interventions: state.interventions,
    options: state.options,
  };

  useNetworkStore.setState({ isInferring: true, inferError: null });
  try {
    const response = await runInference(payload, controller.signal);
    if (controller.signal.aborted) return;
    useNetworkStore.setState({
      marginals: response.marginals,
      latencyMs: response.latency_ms,
      methodUsed: response.method_used,
      warnings: response.warnings,
      isInferring: false,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    const message = err instanceof ApiError ? err.message : "Inference request failed";
    useNetworkStore.setState({ isInferring: false, inferError: message });
  }
}

async function runTemporalInferenceNow() {
  const state = useNetworkStore.getState();
  const nodes = Object.values(state.nodeDefs);
  const requestId = ++temporalRequestId;

  const virtualEvidenceList: VirtualEvidenceEntry[] = [];
  for (const [nodeId, bySlice] of Object.entries(state.virtualEvidence)) {
    for (const [slice, distribution] of Object.entries(bySlice)) {
      virtualEvidenceList.push({ node_id: nodeId, time_slice: Number(slice), distribution });
    }
  }

  const payload: NetworkPayload = {
    nodes,
    edges: state.edges,
    evidence: state.evidence,
    interventions: state.interventions,
    options: state.options,
    dbn_time_slices: state.timeSlices,
    virtual_evidence: virtualEvidenceList,
  };

  useNetworkStore.setState({ isTemporalInferring: true, temporalError: null });
  try {
    const response = await runTemporalInference(payload);
    if (requestId !== temporalRequestId) return;
    const temporalMarginals: NetworkState["temporalMarginals"] = {};
    for (const [nodeId, bySlice] of Object.entries(response.marginals)) {
      temporalMarginals[nodeId] = {};
      for (const [slice, dist] of Object.entries(bySlice)) {
        temporalMarginals[nodeId][Number(slice)] = dist;
      }
    }
    useNetworkStore.setState({
      temporalMarginals,
      temporalWarnings: response.warnings,
      isTemporalInferring: false,
    });
  } catch (err) {
    if (requestId !== temporalRequestId) return;
    const message = err instanceof ApiError ? err.message : "Temporal inference request failed";
    useNetworkStore.setState({ isTemporalInferring: false, temporalError: message });
  }
}

export function triggerInitialInference() {
  useNetworkStore.getState().scheduleInference();
  useNetworkStore.getState().loadSolvers();
}

/** React hook for the undo/redo history itself (past/future step counts,
 * `undo`/`redo`/`clear`) -- kept separate from `useNetworkStore` because
 * zundo tracks it as a sibling vanilla store, not part of `NetworkState`. */
export function useTemporalStore<T>(selector: (state: TemporalState<UndoableState>) => T): T {
  return useStore(useNetworkStore.temporal, selector);
}

export function undo() {
  useNetworkStore.temporal.getState().undo();
}

export function redo() {
  useNetworkStore.temporal.getState().redo();
}
