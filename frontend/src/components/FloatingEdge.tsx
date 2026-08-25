import { tokens } from "@fluentui/react-components";
import { BaseEdge, getStraightPath, useInternalNode, type EdgeProps, type InternalNode, type Node } from "@xyflow/react";

import { getFloatingEdgeParams, type NodeBox } from "../lib/floatingEdge";
import { useNetworkStore } from "../store/useNetworkStore";

function toBox(node: InternalNode<Node>): NodeBox {
  const width = node.measured.width ?? 92;
  const height = node.measured.height ?? 92;
  return {
    centerX: node.internals.positionAbsolute.x + width / 2,
    centerY: node.internals.positionAbsolute.y + height / 2,
    width,
    height,
  };
}

export function FloatingEdge({ id, source, target, markerEnd, style, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // do(target=x) surgically cuts every incoming edge for inference
  // purposes -- this edge stays part of the structure (deleting it would
  // be a real structural edit), but rendering it dashed/muted here shows
  // that its influence isn't flowing right now, matching the "graph
  // surgery" mental model.
  const isCut = useNetworkStore((s) => s.interventions[target] !== undefined);

  if (!sourceNode || !targetNode) return null;

  const { sourceX, sourceY, targetX, targetY } = getFloatingEdgeParams(
    toBox(sourceNode),
    toBox(targetNode),
  );
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: isCut ? tokens.colorNeutralStroke3 : selected ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1,
        strokeWidth: selected ? 2.5 : 1.75,
        strokeDasharray: isCut ? "6 4" : undefined,
      }}
    />
  );
}
