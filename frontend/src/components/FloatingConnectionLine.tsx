import { tokens } from "@fluentui/react-components";
import type { ConnectionLineComponentProps } from "@xyflow/react";

import { ellipseBoundaryPoint } from "../lib/floatingEdge";

// Ghost/preview line rendered while dragging a connection: starts at the
// source node's boundary (toward the cursor) rather than a fixed handle
// point, with a gentle live curve and an animated "marching ants" dash so
// an in-progress connection reads clearly against a finished (straight)
// floating edge.
export function FloatingConnectionLine({ fromNode, toX, toY }: ConnectionLineComponentProps) {
  if (!fromNode) return null;

  const width = fromNode.measured.width ?? 92;
  const height = fromNode.measured.height ?? 92;
  const box = {
    centerX: fromNode.internals.positionAbsolute.x + width / 2,
    centerY: fromNode.internals.positionAbsolute.y + height / 2,
    width,
    height,
  };
  const start = ellipseBoundaryPoint(box, { x: toX, y: toY });

  const dx = toX - start.x;
  const dy = toY - start.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Gentle perpendicular bow, capped so short drags don't curl unnaturally.
  const bow = Math.min(dist * 0.18, 32);
  const midX = (start.x + toX) / 2 - (dy / dist) * bow;
  const midY = (start.y + toY) / 2 + (dx / dist) * bow;
  const path = `M ${start.x},${start.y} Q ${midX},${midY} ${toX},${toY}`;

  return (
    <g>
      <path
        fill="none"
        stroke={tokens.colorBrandStroke1}
        strokeWidth={2.5}
        strokeOpacity={0.4}
        d={path}
      />
      <path
        fill="none"
        stroke={tokens.colorBrandStroke1}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="7 6"
        d={path}
      >
        <animate attributeName="stroke-dashoffset" from="26" to="0" dur="0.6s" repeatCount="indefinite" />
      </path>
      <circle cx={start.x} cy={start.y} r={4} fill={tokens.colorBrandStroke1} stroke="none" />
      <circle
        cx={toX}
        cy={toY}
        r={6}
        fill={tokens.colorNeutralBackground1}
        stroke={tokens.colorBrandStroke1}
        strokeWidth={2}
      />
      <circle cx={toX} cy={toY} r={2.25} fill={tokens.colorBrandStroke1} stroke="none" />
    </g>
  );
}
