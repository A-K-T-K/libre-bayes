/**
 * "Floating edge" geometry: connections drawn from node center to node center,
 * clipped at each node's visual boundary (approximated as an ellipse matching
 * its rendered width/height) rather than at fixed handle points -- matching
 * classic Bayesian-network editors like GeNIe.
 */

export interface Point {
  x: number;
  y: number;
}

export interface NodeBox {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** Point where the ray from `box`'s center toward `target` crosses the
 * ellipse boundary inscribed in `box`. */
export function ellipseBoundaryPoint(box: NodeBox, target: Point): Point {
  const rx = box.width / 2;
  const ry = box.height / 2;
  const dx = target.x - box.centerX;
  const dy = target.y - box.centerY;
  if (dx === 0 && dy === 0) {
    return { x: box.centerX, y: box.centerY };
  }
  const denom = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  const t = 1 / (denom || 1);
  return { x: box.centerX + dx * t, y: box.centerY + dy * t };
}

export interface FloatingEdgeParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/** Both endpoints of a center-to-center edge, each clipped to its own
 * node's boundary along the line connecting the two centers. */
export function getFloatingEdgeParams(source: NodeBox, target: NodeBox): FloatingEdgeParams {
  const sourcePoint = ellipseBoundaryPoint(source, { x: target.centerX, y: target.centerY });
  const targetPoint = ellipseBoundaryPoint(target, { x: source.centerX, y: source.centerY });
  return {
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
  };
}
