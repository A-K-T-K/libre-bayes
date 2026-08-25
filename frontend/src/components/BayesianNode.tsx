import {
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  CircleRegular,
  ClockRegular,
  CutRegular,
  DataBarVerticalRegular,
  ResizeRegular,
  DeleteRegular,
  DismissRegular,
  StarFilled,
  Warning16Filled,
} from "@fluentui/react-icons";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import { isColumnStochastic } from "../lib/cpt";
import { BAR_DEFAULT_SIZE, CIRCLE_DEFAULT_SIZE, getBarSize } from "../lib/nodeGeometry";
import { BAR_PALETTE } from "../lib/palette";
import { useNetworkStore } from "../store/useNetworkStore";
import type { NodeDisplayMode, NodeSize } from "../lib/types";

export { CIRCLE_DEFAULT_SIZE, BAR_DEFAULT_SIZE };

export interface BayesianNodeData extends Record<string, unknown> {
  label: string;
  name?: string;
  states: string[];
  parents: string[];
  size?: NodeSize;
  displayMode?: NodeDisplayMode;
  temporal?: boolean;
  /** True while 2+ nodes are selected on canvas -- suppresses the resize
   * handles on every member so a multi-select doesn't turn into a forest of
   * resize grips, while the blue "selected" outline still shows on all of
   * them. */
  multiSelectActive?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const useStyles = makeStyles({
  wrapper: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  node: {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    borderRadius: "999px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    gap: "2px",
    cursor: "grab",
    userSelect: "none",
    textAlign: "center",
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("2.5px", "solid", tokens.colorNeutralStroke1),
    boxShadow: tokens.shadow4,
    transition: "box-shadow 0.15s ease, border-color 0.15s ease",
  },
  nodeLinkMode: {
    cursor: "crosshair",
  },
  nodeSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: tokens.shadow16,
  },
  // Observed evidence (X=x): solid amber border.
  nodeEvidence: {
    ...shorthands.borderColor(tokens.colorPaletteMarigoldBorderActive),
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
  },
  // do(X=x): glowing violet border -- visually distinct from mere
  // observation, since the causal meaning is different (graph surgery, not
  // conditioning).
  nodeIntervention: {
    ...shorthands.borderColor(tokens.colorPaletteGrapeBorderActive),
    backgroundColor: tokens.colorPaletteGrapeBackground2,
    boxShadow: `0 0 0 3px ${tokens.colorPaletteGrapeBackground2}, ${tokens.shadow16}`,
  },
  interventionBadge: {
    position: "absolute",
    top: "-6px",
    left: "-6px",
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    backgroundColor: tokens.colorPaletteGrapeForeground2,
    color: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    pointerEvents: "none",
  },
  label: {
    fontWeight: 600,
    lineHeight: 1.2,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  },
  labelEditInput: {
    maxWidth: "100%",
    minWidth: "40px",
  },
  caption: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  captionEvidence: {
    color: tokens.colorPaletteMarigoldForeground1,
    fontWeight: 600,
  },
  captionIntervention: {
    color: tokens.colorPaletteGrapeForeground2,
    fontWeight: 600,
  },
  // Bar-chart display mode: a rectangular card with one horizontal,
  // color-coded bar per state, GeNIe-style.
  barCard: {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "6px 10px",
    cursor: "grab",
    userSelect: "none",
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("2px", "solid", tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    boxShadow: tokens.shadow4,
    transition: "box-shadow 0.15s ease, border-color 0.15s ease",
  },
  barLabel: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  barRows: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 0,
  },
  barItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    cursor: "pointer",
  },
  barStateLabel: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textAlign: "right",
  },
  barTrack: {
    flex: 1,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground4,
    borderRadius: "999px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: "999px",
    transition: "width 0.2s ease, background-color 0.15s ease",
  },
  barPercent: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  },
  // A single handle spanning the whole node: dragging from anywhere within
  // the shape starts a connection, matching a "link" tool in drawing apps.
  // It's only interactive while the link tool is active -- otherwise the
  // node underneath handles its own drag-to-move and click-to-select.
  fullBodyHandle: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    borderRadius: "999px",
    backgroundColor: "transparent",
    border: "none",
    opacity: 0,
    pointerEvents: "none",
    transform: "none",
  },
  mapBadge: {
    position: "absolute",
    top: "-6px",
    right: "-6px",
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    backgroundColor: tokens.colorPaletteGoldBackground2,
    color: tokens.colorPaletteGoldForeground2,
    boxShadow: tokens.shadow4,
    pointerEvents: "none",
  },
  barItemDimmed: {
    opacity: 0.35,
  },
  barItemMapWinner: {
    fontWeight: 700,
  },
  warningBadge: {
    position: "absolute",
    top: "-6px",
    right: "-6px",
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    pointerEvents: "none",
  },
  // Minimal marker for a Dynamic BN "temporal" node (persists t-1 -> t) --
  // bottom-left, the one corner the intervention/MAP/warning badges don't
  // already use, kept deliberately muted (neutral, not a loud accent color)
  // since it's informational rather than an alert.
  temporalBadge: {
    position: "absolute",
    bottom: "-6px",
    left: "-6px",
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground3,
    border: `1.5px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow2,
    pointerEvents: "none",
  },
});

function BayesianNodeImpl({ id, data, selected }: NodeProps) {
  const styles = useStyles();
  const nodeData = data as BayesianNodeData;
  const marginals = useNetworkStore((s) => s.marginals[id]);
  const evidenceState = useNetworkStore((s) => s.evidence[id]);
  const toggleEvidence = useNetworkStore((s) => s.toggleEvidence);
  const interventionState = useNetworkStore((s) => s.interventions[id]);
  const toggleIntervention = useNetworkStore((s) => s.toggleIntervention);
  const mode = useNetworkStore((s) => s.mode);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const removeNode = useNetworkStore((s) => s.removeNode);
  const updateNodeSize = useNetworkStore((s) => s.updateNodeSize);
  const updateNodePosition = useNetworkStore((s) => s.updateNodePosition);
  const setNodeDisplayMode = useNetworkStore((s) => s.setNodeDisplayMode);
  const setNodeDisplayModeMany = useNetworkStore((s) => s.setNodeDisplayModeMany);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const equalizeSize = useNetworkStore((s) => s.equalizeSize);
  const setNodeName = useNetworkStore((s) => s.setNodeName);
  const tool = useNetworkStore((s) => s.tool);
  const cpt = useNetworkStore((s) => s.nodeDefs[id]?.cpt);
  const cptValid = useMemo(() => (cpt ? isColumnStochastic(cpt) : true), [cpt]);
  const mapState = useNetworkStore((s) => s.mapAssignment?.[id]);
  const dbnEnabled = useNetworkStore((s) => s.dbnEnabled);
  const setNodeTemporal = useNetworkStore((s) => s.setNodeTemporal);

  // Tracks the size while a resize handle is actively being dragged, purely
  // to scale typography live -- NodeResizer itself already owns resizing
  // the actual node box in real time, so this never drives layout.
  const [liveSize, setLiveSize] = useState<NodeSize | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const hasEvidence = evidenceState !== undefined;
  const hasIntervention = interventionState !== undefined;
  const isLinkMode = tool === "link";

  // Which action a click on a state performs -- gated by the global mode so
  // "set evidence" and "do()" can't happen by accident outside their own
  // mode. Design mode has no dedicated action of its own, so a bar-row
  // click there defaults to setting evidence -- letting a bar-chart node
  // double as a quick evidence toggle without forcing a mode switch first.
  const setState = (state: string) => {
    if (mode === "intervene") toggleIntervention(id, state);
    else toggleEvidence(id, state);
  };
  const displayMode: NodeDisplayMode = nodeData.displayMode ?? "circle";
  const isBarMode = displayMode === "bar";
  // The natural, content-fitted size for this node's state count -- used as
  // both the unresized default and the scale-factor baseline, so a bar card
  // with few states doesn't inherit a taller card's worth of empty space.
  const naturalBarSize = isBarMode ? getBarSize(nodeData.states.length) : BAR_DEFAULT_SIZE;
  const size = nodeData.size ?? (isBarMode ? naturalBarSize : CIRCLE_DEFAULT_SIZE);
  const effectiveSize = liveSize ?? size;
  const displayLabel = nodeData.name ?? nodeData.label;

  const referenceSize = isBarMode ? naturalBarSize : CIRCLE_DEFAULT_SIZE;
  const scale = clamp(
    Math.min(effectiveSize.width / referenceSize.width, effectiveSize.height / referenceSize.height),
    0.45,
    2.75,
  );

  const topState =
    marginals &&
    Object.entries(marginals).reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
      ["", -1] as [string, number],
    );

  const tooltipContent =
    nodeData.states.map((s) => `${s}: ${((marginals?.[s] ?? 0) * 100).toFixed(1)}%`).join("  ·  ") +
    (cptValid ? "" : "  ⚠ CPT columns don't sum to 1.0") +
    (hasIntervention ? `  ·  do(${id}=${interventionState})` : "") +
    (nodeData.name ? `  ·  id: ${nodeData.label}` : "");

  const handleResize = (_event: unknown, params: { width: number; height: number }) => {
    setLiveSize({ width: params.width, height: params.height });
  };

  const handleResizeEnd = (
    _event: unknown,
    params: { x: number; y: number; width: number; height: number },
  ) => {
    updateNodeSize(id, { width: params.width, height: params.height });
    updateNodePosition(id, { x: params.x, y: params.y });
    setLiveSize(null);
  };

  const handleSelectClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    selectNode(id, { toggle: e.ctrlKey || e.metaKey || e.shiftKey });
  };

  // Picking a display mode while this node is part of a multi-selection
  // applies it to every selected node, not just the one that was
  // right-clicked; with no (or a single-node) selection it only ever
  // affects this node.
  const isInMultiSelect = selectedNodeIds.length > 1 && selectedNodeIds.includes(id);
  const applyDisplayMode = (mode: NodeDisplayMode) => {
    if (isInMultiSelect) setNodeDisplayModeMany(selectedNodeIds, mode);
    else setNodeDisplayMode(id, mode);
  };

  const startEditingName = () => {
    setNameDraft(displayLabel);
    setEditingName(true);
  };
  const commitNameEdit = () => {
    setNodeName(id, nameDraft);
    setEditingName(false);
  };

  const nameLabel = editingName ? (
    <Input
      className={styles.labelEditInput}
      size="small"
      autoFocus
      value={nameDraft}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(_, d) => setNameDraft(d.value)}
      onBlur={commitNameEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitNameEdit();
        if (e.key === "Escape") setEditingName(false);
      }}
    />
  ) : (
    <span
      className={styles.label}
      style={isBarMode ? undefined : { fontSize: `${clamp(13 * scale, 9, 24)}px` }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEditingName();
      }}
    >
      {displayLabel}
    </span>
  );

  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>
        <div className={styles.wrapper}>
          <NodeResizer
            isVisible={selected && !nodeData.multiSelectActive}
            minWidth={isBarMode ? 100 : 56}
            minHeight={isBarMode ? 72 : 56}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />

          <Handle
            type="source"
            position={Position.Top}
            id={id}
            isConnectableStart
            isConnectableEnd
            className={styles.fullBodyHandle}
            style={{ pointerEvents: isLinkMode ? "auto" : "none" }}
          />

          {!cptValid && (
            <Tooltip content="CPT columns don't sum to 1.0 — open the inspector to fix" relationship="label">
              <div className={styles.warningBadge}>
                <Warning16Filled />
              </div>
            </Tooltip>
          )}

          {hasIntervention && (
            <Tooltip content={`do(${id} = ${interventionState}) — incoming influences are cut`} relationship="label">
              <div className={styles.interventionBadge}>
                <CutRegular fontSize={12} />
              </div>
            </Tooltip>
          )}

          {mapState && (
            <Tooltip content={`Most likely scenario: ${id} = ${mapState}`} relationship="label">
              <div className={styles.mapBadge}>
                <StarFilled fontSize={12} />
              </div>
            </Tooltip>
          )}

          {nodeData.temporal && (
            <Tooltip content={`Temporal node — persists across Dynamic BN time slices (t−1 → t)`} relationship="label">
              <div className={styles.temporalBadge}>
                <ClockRegular fontSize={11} />
              </div>
            </Tooltip>
          )}

          <Tooltip content={tooltipContent} relationship="label" positioning="above">
            {isBarMode ? (
              <div
                className={mergeClasses(
                  styles.barCard,
                  isLinkMode && styles.nodeLinkMode,
                  selected && styles.nodeSelected,
                  hasIntervention ? styles.nodeIntervention : hasEvidence && styles.nodeEvidence,
                )}
                style={{ gap: `${clamp(4 * scale, 2, 10)}px` }}
                onClick={handleSelectClick}
              >
                <span className={styles.barLabel} style={{ fontSize: `${clamp(12 * scale, 8, 20)}px` }}>
                  {editingName ? (
                    <Input
                      className={styles.labelEditInput}
                      size="small"
                      autoFocus
                      value={nameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(_, d) => setNameDraft(d.value)}
                      onBlur={commitNameEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitNameEdit();
                        if (e.key === "Escape") setEditingName(false);
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditingName();
                      }}
                    >
                      {displayLabel}
                    </span>
                  )}
                </span>
                <div className={styles.barRows} style={{ gap: `${clamp(3 * scale, 1, 6)}px` }}>
                  {nodeData.states.map((state, i) => {
                    const prob = marginals?.[state] ?? 0;
                    const isActive = evidenceState === state || interventionState === state;
                    const isMapWinner = mapState === state;
                    const color = BAR_PALETTE[i % BAR_PALETTE.length];
                    return (
                      <div
                        key={state}
                        className={mergeClasses(
                          styles.barItem,
                          mapState && !isMapWinner && styles.barItemDimmed,
                          isMapWinner && styles.barItemMapWinner,
                        )}
                        style={{ gap: `${clamp(5 * scale, 3, 8)}px`, cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setState(state);
                        }}
                      >
                        <span
                          className={styles.barStateLabel}
                          style={{
                            fontSize: `${clamp(8 * scale, 6, 12)}px`,
                            width: `${clamp(30 * scale, 20, 50)}px`,
                            color: isActive ? tokens.colorBrandForeground1 : undefined,
                            fontWeight: isActive ? 700 : undefined,
                          }}
                        >
                          {state}
                        </span>
                        <div
                          className={styles.barTrack}
                          style={{
                            height: `${clamp(7 * scale, 5, 12)}px`,
                            // Drawn on the track (not the fill) so it isn't clipped by the
                            // track's own overflow:hidden -- an outline on the fill sits flush
                            // with (or past) the track's rounded edge and gets cut off.
                            outline: isActive ? `2px solid ${tokens.colorBrandStroke1}` : undefined,
                            outlineOffset: isActive ? "1px" : undefined,
                          }}
                        >
                          <div
                            className={styles.barFill}
                            style={{
                              width: `${Math.max(2, prob * 100)}%`,
                              backgroundColor: isMapWinner ? tokens.colorPaletteGoldForeground2 : color,
                            }}
                          />
                        </div>
                        <span
                          className={styles.barPercent}
                          style={{ fontSize: `${clamp(7 * scale, 6, 11)}px`, width: `${clamp(24 * scale, 18, 36)}px` }}
                        >
                          {(prob * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                className={mergeClasses(
                  styles.node,
                  isLinkMode && styles.nodeLinkMode,
                  selected && styles.nodeSelected,
                  hasIntervention ? styles.nodeIntervention : hasEvidence && styles.nodeEvidence,
                )}
                onClick={handleSelectClick}
              >
                {nameLabel}
                <span
                  className={mergeClasses(
                    styles.caption,
                    hasIntervention ? styles.captionIntervention : hasEvidence && styles.captionEvidence,
                  )}
                  style={{ fontSize: `${clamp(10 * scale, 7, 17)}px` }}
                >
                  {hasIntervention
                    ? `do(=${interventionState})`
                    : hasEvidence
                      ? `= ${evidenceState}`
                      : topState && topState[1] >= 0
                        ? `${topState[0]} ${(topState[1] * 100).toFixed(0)}%`
                        : "…"}
                </span>
              </div>
            )}
          </Tooltip>
        </div>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {mode !== "intervene" ? (
            <>
              {nodeData.states.map((state) => (
                <MenuItem
                  key={state}
                  icon={evidenceState === state ? <CheckmarkRegular /> : undefined}
                  onClick={() => toggleEvidence(id, state)}
                >
                  Set evidence: {state}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem
                icon={<DismissRegular />}
                disabled={!hasEvidence}
                onClick={() => evidenceState && toggleEvidence(id, evidenceState)}
              >
                Clear evidence
              </MenuItem>
              <MenuDivider />
            </>
          ) : (
            <>
              {nodeData.states.map((state) => (
                <MenuItem
                  key={state}
                  icon={interventionState === state ? <CheckmarkRegular /> : <CutRegular />}
                  onClick={() => toggleIntervention(id, state)}
                >
                  do({id} = {state})
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem
                icon={<DismissRegular />}
                disabled={!hasIntervention}
                onClick={() => interventionState && toggleIntervention(id, interventionState)}
              >
                Clear intervention
              </MenuItem>
              <MenuDivider />
            </>
          )}
          <MenuItem onClick={startEditingName}>Rename…</MenuItem>
          <MenuDivider />
          <MenuItem
            icon={!isBarMode ? <CheckmarkRegular /> : <CircleRegular />}
            onClick={() => applyDisplayMode("circle")}
          >
            Show as node{isInMultiSelect ? ` (${selectedNodeIds.length} selected)` : ""}
          </MenuItem>
          <MenuItem
            icon={isBarMode ? <CheckmarkRegular /> : <DataBarVerticalRegular />}
            onClick={() => applyDisplayMode("bar")}
          >
            Show as bar chart{isInMultiSelect ? ` (${selectedNodeIds.length} selected)` : ""}
          </MenuItem>
          {isInMultiSelect && (
            <MenuItem icon={<ResizeRegular />} onClick={equalizeSize}>
              Make Equal Size ({selectedNodeIds.length} selected)
            </MenuItem>
          )}
          {dbnEnabled && (
            <>
              <MenuDivider />
              <MenuItem
                icon={nodeData.temporal ? <CheckmarkRegular /> : <ClockRegular />}
                onClick={() => setNodeTemporal(id, !nodeData.temporal)}
              >
                Enable Temporal (t−1 → t)
              </MenuItem>
            </>
          )}
          <MenuDivider />
          <MenuItem icon={<DeleteRegular />} onClick={() => removeNode(id)}>
            Delete Node
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export const BayesianNode = memo(BayesianNodeImpl);
