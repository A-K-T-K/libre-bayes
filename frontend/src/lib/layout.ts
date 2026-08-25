import dagre from "@dagrejs/dagre";

import type { NodeSize, Position } from "./types";

const DEFAULT_NODE_SIZE: NodeSize = { width: 92, height: 92 };

export interface LayoutInput {
  id: string;
  size?: NodeSize;
}

/** Sugiyama-style layered layout (via dagre) for auto-arranging the graph,
 * respecting each node's actual rendered size (circle, drawn ellipse, or
 * bar-chart card) rather than a single fixed box for every node. */
export function autoLayout(
  nodes: LayoutInput[],
  edges: [string, string][],
): Record<string, Position> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

  nodes.forEach((node) => {
    const size = node.size ?? DEFAULT_NODE_SIZE;
    graph.setNode(node.id, { width: size.width, height: size.height });
  });
  edges.forEach(([source, target]) => {
    graph.setEdge(source, target);
  });

  dagre.layout(graph);

  const positions: Record<string, Position> = {};
  for (const node of nodes) {
    const { x, y } = graph.node(node.id);
    const size = node.size ?? DEFAULT_NODE_SIZE;
    positions[node.id] = { x: x - size.width / 2, y: y - size.height / 2 };
  }
  return positions;
}
