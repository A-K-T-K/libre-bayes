import type { NodeDefinition, NodeSize } from "./types";

export const CIRCLE_DEFAULT_SIZE: NodeSize = { width: 92, height: 92 };
export const BAR_DEFAULT_SIZE: NodeSize = { width: 168, height: 104 };

// Mirrors the bar card's own vertical rhythm (padding + label + one row per
// state) so the box a bar node is given is exactly the box its content
// needs -- no leftover whitespace when there are few states, no overflow
// (and no overlap with layout neighbors) when there are many.
const BAR_PADDING_V = 14;
const BAR_HEADER_HEIGHT = 20;
const BAR_ROW_HEIGHT = 18;
const BAR_ROW_GAP = 4;
const BAR_MIN_HEIGHT = 72;

/** The natural (unresized) box height for a bar-mode node with this many
 * states -- grows with state count instead of a single fixed height for
 * every node. */
export function getBarSize(stateCount: number): NodeSize {
  const rows = Math.max(stateCount, 1);
  const height = BAR_PADDING_V + BAR_HEADER_HEIGHT + rows * BAR_ROW_HEIGHT + (rows - 1) * BAR_ROW_GAP;
  return { width: BAR_DEFAULT_SIZE.width, height: Math.max(BAR_MIN_HEIGHT, height) };
}

/** The on-canvas box size a node definition actually renders at -- an
 * explicit user-set `size` if present, otherwise the default for its
 * display mode (state-count-aware for bar mode). Shared by canvas
 * rendering and by alignment/distribution/layout math so all of them agree
 * on node extents without importing the node component itself (which would
 * create a component <-> store circular import). */
export function getEffectiveSize(def: Pick<NodeDefinition, "size" | "displayMode" | "states">): NodeSize {
  if (def.size) return def.size;
  return def.displayMode === "bar" ? getBarSize(def.states.length) : CIRCLE_DEFAULT_SIZE;
}
