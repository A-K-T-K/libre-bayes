import { Button, Divider, Tooltip, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { useMemo } from "react";
import { useViewport } from "@xyflow/react";

import { ALIGNMENT_ACTIONS } from "../lib/alignmentActions";
import { getEffectiveSize } from "../lib/nodeGeometry";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  toolbar: {
    position: "absolute",
    zIndex: 5,
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "4px",
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    transform: "translate(-50%, calc(-100% - 10px))",
    pointerEvents: "auto",
  },
});

/** Floating action bar shown above the bounding box of a 2+ node
 * multi-selection, positioned in the same coordinate frame as the React
 * Flow pane (via `useViewport`) so it tracks pan/zoom without its own
 * DOM-measurement pass. */
export function AlignmentToolbar() {
  const styles = useStyles();
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const alignNodes = useNetworkStore((s) => s.alignNodes);
  const distributeNodes = useNetworkStore((s) => s.distributeNodes);
  const equalizeSize = useNetworkStore((s) => s.equalizeSize);
  const { x: vx, y: vy, zoom } = useViewport();

  const bbox = useMemo(() => {
    if (selectedNodeIds.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of selectedNodeIds) {
      const def = nodeDefs[id];
      if (!def) continue;
      const pos = def.position ?? { x: 0, y: 0 };
      const size = getEffectiveSize(def);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }, [selectedNodeIds, nodeDefs]);

  if (!bbox) return null;

  const left = ((bbox.minX + bbox.maxX) / 2) * zoom + vx;
  const top = bbox.minY * zoom + vy;

  return (
    <div className={styles.toolbar} style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {ALIGNMENT_ACTIONS.map((action, i) => (
        <span key={action.key} style={{ display: "flex", alignItems: "center" }}>
          {(i === 6 || i === 8) && <Divider vertical style={{ height: "20px", margin: "0 2px" }} />}
          <Tooltip content={action.label} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<action.icon />}
              disabled={selectedNodeIds.length < action.minSelected}
              onClick={() => action.run({ alignNodes, distributeNodes, equalizeSize })}
            />
          </Tooltip>
        </span>
      ))}
    </div>
  );
}
