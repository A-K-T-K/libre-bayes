/**
 * Renders the current network as a hand-built vector SVG -- real <circle>,
 * <rect>, <text>, and <path> elements, not a rasterized screenshot of the
 * DOM -- so SVG/PDF exports stay genuinely vector (crisp at any zoom,
 * editable text) and PNG export can rasterize that same source at whatever
 * resolution it needs.
 *
 * Colors are hardcoded to the app's light theme regardless of the app's
 * current theme, and only the network itself is drawn -- no dot-grid
 * background, minimap, or other canvas chrome.
 */

import { getFloatingEdgeParams, type NodeBox } from "./floatingEdge";
import { getEffectiveSize } from "./nodeGeometry";
import type { NodeDefinition } from "./types";

const PADDING = 40;

const COLORS = {
  background: "#ffffff",
  stroke: "#d1d1d1",
  strokeFaint: "#f0f0f0",
  brandStroke: "#0f6cbd",
  neutralFg1: "#242424",
  neutralFg2: "#424242",
  neutralFg3: "#616161",
  barTrackBg: "#f0f0f0",
  evidenceBorder: "#eaa300",
  evidenceBg: "#fefbf4",
  evidenceFg: "#d39300",
  interventionBorder: "#881798",
  interventionBg: "#d9a7e0",
  interventionFg: "#4c0d55",
  goldBg: "#ecdfa5",
  goldFg: "#6c5700",
};

const BAR_PALETTE = [
  "#004377", // blue
  "#835b00", // marigold
  "#6d2064", // berry
  "#02494c", // teal
  "#4c0d55", // grape
  "#712d09", // pumpkin
  "#6e0811", // cranberry
  "#094509", // green
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface NetworkExportOptions {
  nodeDefs: Record<string, NodeDefinition>;
  edges: [string, string][];
  marginals: Record<string, Record<string, number>>;
  evidence: Record<string, string>;
  interventions: Record<string, string>;
  mapAssignment: Record<string, string> | null;
}

interface LaidOutNode {
  id: string;
  def: NodeDefinition;
  x: number;
  y: number;
  width: number;
  height: number;
  box: NodeBox;
}

export interface RenderedNetworkSvg {
  svg: string;
  width: number;
  height: number;
}

export function renderNetworkSvg(opts: NetworkExportOptions): RenderedNetworkSvg {
  const { nodeDefs, edges, marginals, evidence, interventions, mapAssignment } = opts;
  const ids = Object.keys(nodeDefs);

  const nodes: LaidOutNode[] = ids.map((id) => {
    const def = nodeDefs[id];
    const pos = def.position ?? { x: 0, y: 0 };
    const size = getEffectiveSize(def);
    return {
      id,
      def,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      box: { centerX: pos.x + size.width / 2, centerY: pos.y + size.height / 2, width: size.width, height: size.height },
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edgeSvg = edges
    .map(([source, target]) => {
      const s = byId.get(source);
      const t = byId.get(target);
      if (!s || !t) return "";
      const { sourceX, sourceY, targetX, targetY } = getFloatingEdgeParams(s.box, t.box);
      const isCut = interventions[target] !== undefined;
      const x1 = sourceX + offsetX;
      const y1 = sourceY + offsetY;
      const x2 = targetX + offsetX;
      const y2 = targetY + offsetY;
      const stroke = isCut ? COLORS.strokeFaint : COLORS.stroke;
      const dash = isCut ? ' stroke-dasharray="6 4"' : "";
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="1.75"${dash} marker-end="url(#arrow)" />`;
    })
    .join("\n");

  const nodeSvg = nodes.map((n) => renderNode(n, offsetX, offsetY, marginals[n.id], evidence[n.id], interventions[n.id], mapAssignment?.[n.id])).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.stroke}" />
    </marker>
  </defs>
  <g>
${edgeSvg}
${nodeSvg}
  </g>
</svg>`;

  return { svg, width, height };
}

function renderNode(
  n: LaidOutNode,
  offsetX: number,
  offsetY: number,
  marginal: Record<string, number> | undefined,
  evidenceState: string | undefined,
  interventionState: string | undefined,
  mapState: string | undefined,
): string {
  const x = n.x + offsetX;
  const y = n.y + offsetY;
  const { width, height } = n;
  const isBar = n.def.displayMode === "bar";
  const label = escapeXml(n.def.name ?? n.def.id);

  const hasIntervention = interventionState !== undefined;
  const hasEvidence = evidenceState !== undefined;
  const borderColor = hasIntervention ? COLORS.interventionBorder : hasEvidence ? COLORS.evidenceBorder : COLORS.stroke;
  const fillColor = hasIntervention ? COLORS.interventionBg : hasEvidence ? COLORS.evidenceBg : COLORS.background;

  const parts: string[] = [];

  if (isBar) {
    parts.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="8" fill="${fillColor}" stroke="${borderColor}" stroke-width="2" />`,
    );
    parts.push(
      `<text x="${(x + width / 2).toFixed(2)}" y="${(y + 20).toFixed(2)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="14" font-weight="700" fill="${COLORS.neutralFg1}">${label}</text>`,
    );
    const states = n.def.states;
    const rowsTop = y + 34;
    const rowHeight = (height - 44) / Math.max(states.length, 1);
    const labelColW = 44;
    const percentColW = 34;
    const trackX = x + 10 + labelColW;
    const trackW = Math.max(10, width - 20 - labelColW - percentColW);
    states.forEach((state, i) => {
      const prob = marginal?.[state] ?? 0;
      const rowY = rowsTop + i * rowHeight + rowHeight / 2;
      const isWinner = mapState === state;
      const color = isWinner ? COLORS.goldFg : BAR_PALETTE[i % BAR_PALETTE.length];
      const barH = Math.min(10, rowHeight - 4);
      parts.push(
        `<text x="${(x + 10 + labelColW - 6).toFixed(2)}" y="${(rowY + 4).toFixed(2)}" text-anchor="end" font-family="Segoe UI, sans-serif" font-size="10" fill="${COLORS.neutralFg2}">${escapeXml(state)}</text>`,
      );
      parts.push(
        `<rect x="${trackX.toFixed(2)}" y="${(rowY - barH / 2).toFixed(2)}" width="${trackW.toFixed(2)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}" fill="${COLORS.barTrackBg}" />`,
      );
      const fillW = Math.max(2, trackW * prob);
      parts.push(
        `<rect x="${trackX.toFixed(2)}" y="${(rowY - barH / 2).toFixed(2)}" width="${fillW.toFixed(2)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}" fill="${color}" />`,
      );
      parts.push(
        `<text x="${(x + width - 8).toFixed(2)}" y="${(rowY + 4).toFixed(2)}" text-anchor="end" font-family="Segoe UI, sans-serif" font-size="9" fill="${COLORS.neutralFg3}">${(prob * 100).toFixed(0)}%</text>`,
      );
    });
  } else {
    const cx = x + width / 2;
    const cy = y + height / 2;
    parts.push(
      `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${(width / 2).toFixed(2)}" ry="${(height / 2).toFixed(2)}" fill="${fillColor}" stroke="${borderColor}" stroke-width="2.5" />`,
    );
    parts.push(
      `<text x="${cx.toFixed(2)}" y="${(cy - 4).toFixed(2)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="14" font-weight="700" fill="${COLORS.neutralFg1}">${label}</text>`,
    );
    let caption: string;
    if (hasIntervention) caption = `do(=${interventionState})`;
    else if (hasEvidence) caption = `= ${evidenceState}`;
    else {
      const top = marginal
        ? Object.entries(marginal).reduce((best, e) => (e[1] > best[1] ? e : best), ["", -1] as [string, number])
        : null;
      caption = top && top[1] >= 0 ? `${top[0]} ${(top[1] * 100).toFixed(0)}%` : "";
    }
    const captionColor = hasIntervention ? COLORS.interventionFg : hasEvidence ? COLORS.evidenceFg : COLORS.neutralFg3;
    parts.push(
      `<text x="${cx.toFixed(2)}" y="${(cy + 14).toFixed(2)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" fill="${captionColor}">${escapeXml(caption)}</text>`,
    );
  }

  if (mapState && !isBar) {
    const bx = x + width - 4;
    const by = y + 4;
    parts.push(`<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="8" fill="${COLORS.goldBg}" stroke="${COLORS.goldFg}" stroke-width="1" />`);
    parts.push(
      `<text x="${bx.toFixed(2)}" y="${(by + 3).toFixed(2)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="10" fill="${COLORS.goldFg}">★</text>`,
    );
  }

  return parts.join("\n");
}
