# Modeling Canvas

The canvas is a [React Flow](https://reactflow.dev/)-based editor for directed acyclic graphs, with everything a
Bayesian network needs layered on top.

## Nodes

- **Add Node** places a default two-state node; drag with the node tool to draw one at a specific size.
- Each node has two display modes, switchable per-node or across a multi-selection via right-click:
  - **Circle** -- shows the label and its top state's probability.
  - **Bar chart** -- one color-coded horizontal bar per state, with live percentages.
- Nodes are freely resizable; **Make Equal Size** normalizes a multi-selection to the largest member's dimensions.
- Double-click a label to rename it. A node's *identifier* (used by edges, CPT references, and evidence) and its
  optional *display name* (cosmetic only) are edited separately from the Inspector.

## Edges

Drag from anywhere inside one node to another with the **link tool** to connect them -- the source becomes a
parent of the target, and the target's CPT automatically resizes to add a column-dimension for the new parent.
Cycles are rejected outright; a Bayesian network must stay acyclic.

## Layout

**Auto Layout** arranges the graph with Dagre's layered (Sugiyama-style) algorithm, respecting each node's actual
rendered size rather than a fixed box. Multi-select alignment (left/right/top/bottom/center) and horizontal/vertical
distribution tools are available once 2+ (or 3+, for distribution) nodes are selected.

## Modes

A single global mode governs what clicking a node's state does:

| Mode | Effect |
| --- | --- |
| **Design & Edit** | Structural editing -- add/remove nodes and edges, edit CPTs |
| **Observation** | Click a state to pin it as hard evidence (`X = x`); click again to clear |
| **Intervention** | Click a state to apply a causal `do(X = x)` -- incoming edges are cut and shown dashed |

A node can never be both observed and intervened on at once; setting one clears the other.

## Undo / redo

Every structural or evidence/intervention change is tracked (Ctrl+Z / Ctrl+Shift+Z), scoped to the network itself
-- panel visibility, pan/zoom, and selection don't create undo steps.
