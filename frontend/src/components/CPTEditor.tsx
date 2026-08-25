import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Dropdown,
  InlineDrawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  ProgressBar,
  Spinner,
  Tag,
  TagGroup,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AddCircle24Regular,
  ArrowExpand20Regular,
  ArrowShuffle24Regular,
  CheckmarkCircle24Filled,
  CircleRegular,
  ClockRegular,
  Dismiss24Regular,
  Scales24Regular,
  SubtractCircle24Regular,
} from "@fluentui/react-icons";
import { HotTable } from "@handsontable/react-wrapper";
import type { HotTableRef } from "@handsontable/react-wrapper";
import type Handsontable from "handsontable";
import type { HotInstance } from "handsontable";
import { registerAllModules } from "handsontable/registry";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildHeaderTiers,
  columnValidity,
  emptyCpt,
  isColumnStochastic,
  normalizeCptColumns,
  randomizeCpt,
  uniformCpt,
} from "../lib/cpt";
import { BAR_PALETTE } from "../lib/palette";
import type { NodeDefinition } from "../lib/types";
import { transitionParents, useNetworkStore } from "../store/useNetworkStore";

registerAllModules();

const HOVER_EXPAND_DELAY_MS = 1000;

/** Rejects negative numbers and anything above 1 -- Handsontable reverts the
 * edit and flashes the cell red (its built-in `htInvalid` styling) when a
 * validator returns false and `allowInvalid` is off, so this alone covers
 * "disable typing more than 1 and negative numbers with subtle feedback". */
function probabilityValidator(value: unknown, callback: (valid: boolean) => void) {
  const num = Number(value);
  callback(Number.isFinite(num) && num >= 0 && num <= 1);
}

const useStyles = makeStyles({
  drawer: {
    width: "clamp(300px, 25vw, 420px)",
    maxWidth: "90vw",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "10px",
  },
  toolbar: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  identityRow: {
    display: "flex",
    gap: "6px",
  },
  statesRow: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  tableOuter: {
    position: "relative",
    width: "100%",
    minWidth: 0,
  },
  hotWrap: {
    width: "100%",
    minWidth: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
  },
  hotWrapFill: {
    flex: 1,
    minHeight: 0,
    height: "100%",
  },
  expandButton: {
    position: "absolute",
    top: "4px",
    right: "4px",
    // Handsontable's own sticky column headers use a z-index well above
    // typical app chrome, so this has to clear that rather than the usual
    // handful of stacking layers in the rest of the app.
    zIndex: 1000,
    minWidth: 0,
    opacity: 0,
    transition: "opacity 0.15s ease",
  },
  expandButtonVisible: {
    opacity: 1,
  },
  stateLabelColumn: {
    fontWeight: 600,
  },
  colInvalid: {
    // Handsontable's own theme CSS targets cells with equal-or-higher
    // specificity than a single Griffel atomic class, so without
    // `!important` this subtle accent would silently lose the cascade.
    backgroundColor: `${tokens.colorPaletteRedBackground1} !important`,
  },
  evidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  evidenceLabel: {
    width: "76px",
    flexShrink: 0,
    fontSize: "12px",
    minHeight: 0,
    padding: "2px 8px",
  },
  evidenceBar: {
    flex: 1,
  },
  evidencePercent: {
    width: "42px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  dialogSurface: {
    width: "min(1100px, 92vw)",
    maxWidth: "92vw",
  },
  dialogBody: {
    // Keep DialogBody's own `display: grid` (title row + 1fr content row)
    // -- it's what makes DialogContent's grid-row:2 actually resolve to a
    // bounded height instead of just sizing to its content.
    height: "85vh",
    maxHeight: "85vh",
  },
  dialogContent: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minHeight: 0,
    height: "100%",
  },
  temporalHeading: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  veRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
  },
  veDropdown: {
    minWidth: "90px",
    minHeight: 0,
  },
  veTagRow: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
  },
  chartWrap: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "8px",
  },
  chartLegend: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "6px",
  },
  chartLegendItem: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground2,
  },
  chartSwatch: {
    width: "8px",
    height: "8px",
    borderRadius: "2px",
    flexShrink: 0,
  },
});

const CHART_SIZES = {
  small: { width: 340, height: 130, padL: 30, padR: 8, padT: 8, padB: 18, pointR: 2.25 },
  large: { width: 900, height: 420, padL: 46, padR: 20, padT: 16, padB: 34, pointR: 3.5 },
};

/** A minimal hand-drawn line chart (no charting library) of one node's
 * marginal-per-state trajectory across Dynamic BN time slices -- X is the
 * slice index (gridded, one tick per slice unless there are too many to fit
 * without overlapping), Y is probability 0..1 (gridded at 0/25/50/75/100%),
 * one point-marked polyline per state in the same palette its bar-chart
 * rendering uses. */
function TrajectoryChart({
  states,
  slices,
  size = "small",
}: {
  states: string[];
  slices: Record<number, Record<string, number>>;
  size?: "small" | "large";
}) {
  const styles = useStyles();
  const timeSliceCount = Object.keys(slices).length;
  if (timeSliceCount === 0) return null;

  const { width, height, padL, padR, padT, padB, pointR } = CHART_SIZES[size];
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xFor = (t: number) => padL + (timeSliceCount === 1 ? innerW / 2 : (t / (timeSliceCount - 1)) * innerW);
  const yFor = (p: number) => padT + innerH * (1 - p);

  // Thin out x-axis tick labels once slices are too dense to fit ~26px/label
  // without overlapping -- gridlines still exist at every slice regardless
  // of whether that slice gets a text label.
  const maxLabels = Math.max(1, Math.floor(innerW / 26));
  const xTickStep = Math.max(1, Math.ceil(timeSliceCount / maxLabels));
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const fontSize = size === "large" ? 11 : 8;

  return (
    <div className={styles.chartWrap}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Marginal probability over time"
      >
        {yTicks.map((p) => (
          <g key={p}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yFor(p)}
              y2={yFor(p)}
              stroke={tokens.colorNeutralStroke2}
              strokeWidth={1}
              strokeDasharray={p === 0 || p === 1 ? undefined : "2 3"}
            />
            <text x={padL - 4} y={yFor(p) + fontSize / 3} textAnchor="end" fontSize={fontSize} fill={tokens.colorNeutralForeground3}>
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {Array.from({ length: timeSliceCount }, (_, t) => t).map((t) => (
          <g key={t}>
            <line x1={xFor(t)} x2={xFor(t)} y1={padT} y2={height - padB} stroke={tokens.colorNeutralStroke2} strokeWidth={1} strokeDasharray="2 3" />
            {(t % xTickStep === 0 || t === timeSliceCount - 1) && (
              <text x={xFor(t)} y={height - padB + fontSize + 3} textAnchor="middle" fontSize={fontSize} fill={tokens.colorNeutralForeground3}>
                t={t}
              </text>
            )}
          </g>
        ))}
        {states.map((state, i) => {
          const color = BAR_PALETTE[i % BAR_PALETTE.length];
          const coords = Array.from({ length: timeSliceCount }, (_, t) => [xFor(t), yFor(slices[t]?.[state] ?? 0)] as const);
          return (
            <g key={state}>
              <polyline
                points={coords.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {coords.map(([x, y], t) => (
                <circle key={t} cx={x} cy={y} r={pointR} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className={styles.chartLegend}>
        {states.map((state, i) => (
          <span key={state} className={styles.chartLegendItem}>
            <span className={styles.chartSwatch} style={{ backgroundColor: BAR_PALETTE[i % BAR_PALETTE.length] }} />
            {state}
          </span>
        ))}
      </div>
    </div>
  );
}

interface CptTableProps {
  node: NodeDefinition;
  parentDefs: NodeDefinition[];
  onCellChange: (row: number, col: number, value: number) => void;
  onRenameState: (oldState: string, newState: string) => void;
  /** true inside the expanded modal, where the grid should stretch to fill
   * available height and scroll internally instead of using a fixed one. */
  fill?: boolean;
}

function CptTable({ node, parentDefs, onCellChange, onRenameState, fill }: CptTableProps) {
  const styles = useStyles();
  const hotRef = useRef<HotTableRef>(null);
  const headerTiers = useMemo(() => buildHeaderTiers(parentDefs), [parentDefs]);
  const validity = useMemo(() => columnValidity(node.cpt), [node.cpt]);
  const numCols = node.cpt[0]?.length ?? 0;

  // One header row per parent, each carrying its OWN corner cell (its
  // parent's name) instead of one cell merged/rowSpanned across every tier
  // -- the corner column is "split per row of parent states" this way.
  const nestedHeaders = useMemo<Handsontable.GridSettings["nestedHeaders"]>(() => {
    if (headerTiers.length === 0) {
      return [[{ label: node.id, colspan: 1 }, "—"]];
    }
    return headerTiers.map((tier, tierIndex) => [
      { label: parentDefs[tierIndex]?.id ?? "", colspan: 1 },
      ...tier.map((cell) => ({ label: cell.label, colspan: cell.span })),
    ]);
  }, [headerTiers, parentDefs, node.id]);

  const data = useMemo(
    () => node.states.map((state, r) => [state, ...(node.cpt[r] ?? [])]),
    [node.states, node.cpt],
  );

  const stateNameValidator = useCallback(
    function (this: Handsontable.CellProperties, value: unknown, callback: (valid: boolean) => void) {
      const trimmed = String(value ?? "").trim();
      if (!trimmed) return callback(false);
      const isDuplicate = node.states.some((s, i) => i !== this.row && s === trimmed);
      callback(!isDuplicate);
    },
    [node.states],
  );

  const columns = useMemo(
    () => [
      { data: 0, type: "text", className: styles.stateLabelColumn, validator: stateNameValidator, allowInvalid: false },
      ...Array.from({ length: numCols }, (_, i) => ({
        data: i + 1,
        type: "numeric",
        numericFormat: { pattern: "0.[000]" },
        validator: probabilityValidator,
        allowInvalid: false,
      })),
    ],
    [numCols, styles.stateLabelColumn, stateNameValidator],
  );

  // Subtle red accent on a whole column when it doesn't sum to 1 -- no more
  // per-cell green tint, and no separate sum-row; this is the only signal.
  const cells = useCallback(
    (_row: number, col: number): Partial<Handsontable.CellProperties> => {
      if (col === 0 || validity[col - 1]) return {};
      return { className: styles.colInvalid };
    },
    [validity, styles.colInvalid],
  );

  // Handsontable caches per-cell metadata and only re-invokes `cells()` on
  // its own render pass, not just because the React prop reference changed
  // -- without this, a column crossing the invalid threshold from a live
  // edit wouldn't pick up the accent until some unrelated re-render forced
  // it.
  useEffect(() => {
    hotRef.current?.hotInstance?.render();
  }, [validity]);

  const afterChange = useCallback(
    (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
      if (!changes || source === "loadData") return;
      for (const [row, prop, oldValue, newValue] of changes) {
        if (oldValue === newValue) continue;
        if (prop === 0) {
          onRenameState(String(oldValue), String(newValue).trim());
        } else {
          const col = Number(prop) - 1;
          const parsed = Number(newValue);
          onCellChange(row, col, Number.isFinite(parsed) ? parsed : 0);
        }
      }
    },
    [onCellChange, onRenameState],
  );

  const contextMenu = useMemo<Handsontable.GridSettings["contextMenu"]>(() => {
    const items = {
      balance_column: {
        name: "Set so column sums to 1",
        hidden(this: HotInstance) {
          const sel = this.getSelectedLast();
          return !sel || sel[1] < 1;
        },
        callback: (_key: string, selection: unknown[]) => {
          const range = selection[0] as unknown as { start: { row: number; col: number } };
          const row = range.start.row;
          const col = range.start.col - 1;
          if (col < 0) return;
          const otherSum = node.cpt.reduce((acc, r, ri) => (ri === row ? acc : acc + (r[col] ?? 0)), 0);
          onCellChange(row, col, Math.max(0, 1 - otherSum));
        },
      },
    };
    return { items } as unknown as Handsontable.GridSettings["contextMenu"];
  }, [node.cpt, onCellChange]);

  return (
    <div className={mergeClasses(styles.hotWrap, fill && styles.hotWrapFill)}>
      <HotTable
        ref={hotRef}
        data={data}
        columns={columns}
        nestedHeaders={nestedHeaders}
        cells={cells}
        rowHeaders={false}
        fixedColumnsStart={1}
        manualColumnResize={false}
        manualRowResize={false}
        contextMenu={contextMenu}
        outsideClickDeselects={false}
        licenseKey="non-commercial-and-evaluation"
        afterChange={afterChange}
        height={fill ? "100%" : 240}
        width="100%"
        stretchH="all"
        className="ht-theme-main"
      />
    </div>
  );
}

export function CPTEditor() {
  const styles = useStyles();
  const selectedNodeId = useNetworkStore((s) => s.selectedNodeId);
  const setSelectedNode = useNetworkStore((s) => s.setSelectedNode);
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const updateNodeStates = useNetworkStore((s) => s.updateNodeStates);
  const renameNodeState = useNetworkStore((s) => s.renameNodeState);
  const updateNodeCpt = useNetworkStore((s) => s.updateNodeCpt);
  const renameNode = useNetworkStore((s) => s.renameNode);
  const setNodeName = useNetworkStore((s) => s.setNodeName);
  const marginals = useNetworkStore((s) =>
    selectedNodeId ? s.marginals[selectedNodeId] : undefined,
  );
  const evidenceState = useNetworkStore((s) =>
    selectedNodeId ? s.evidence[selectedNodeId] : undefined,
  );
  const toggleEvidence = useNetworkStore((s) => s.toggleEvidence);
  const updateNodeTransitionCpt = useNetworkStore((s) => s.updateNodeTransitionCpt);
  const timeSlices = useNetworkStore((s) => s.timeSlices);
  const virtualEvidence = useNetworkStore((s) =>
    selectedNodeId ? s.virtualEvidence[selectedNodeId] : undefined,
  );
  const setVirtualEvidence = useNetworkStore((s) => s.setVirtualEvidence);
  const removeVirtualEvidence = useNetworkStore((s) => s.removeVirtualEvidence);
  const temporalMarginals = useNetworkStore((s) =>
    selectedNodeId ? s.temporalMarginals[selectedNodeId] : undefined,
  );
  const isTemporalInferring = useNetworkStore((s) => s.isTemporalInferring);
  const temporalError = useNetworkStore((s) => s.temporalError);
  const temporalWarnings = useNetworkStore((s) => s.temporalWarnings);

  const [newStateName, setNewStateName] = useState("");
  const [showExpandButton, setShowExpandButton] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [trajectoryExpandedOpen, setTrajectoryExpandedOpen] = useState(false);
  const [veSlice, setVeSlice] = useState(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const node = selectedNodeId ? nodeDefs[selectedNodeId] : undefined;
  const parentDefs = useMemo(
    () => (node ? node.parents.map((p) => nodeDefs[p]).filter(Boolean) : []),
    [node, nodeDefs],
  );
  // Display-only: `transitionParents` already labels the self/previous-slice
  // column "(t-1)" -- every *other* column header gets an explicit "(t)"
  // suffix here too (current slice), so the two tiers read unambiguously
  // left-to-right instead of leaving "which one is t?" to be inferred. Pure
  // relabeling -- doesn't touch the ids `resizeTransitionCpt` keys off of.
  const transitionParentDefs = useMemo(() => {
    if (!node) return [];
    return transitionParents(node, nodeDefs).map((p, i) => (i === 0 ? p : { ...p, id: `${p.id} (t)` }));
  }, [node, nodeDefs]);

  if (!node) {
    return <InlineDrawer className={styles.drawer} separator open={false} position="end" />;
  }

  const setCell = (row: number, col: number, value: number) => {
    const cpt = node.cpt.map((r) => [...r]);
    cpt[row][col] = value;
    updateNodeCpt(node.id, cpt);
  };

  const setTransitionCell = (row: number, col: number, value: number) => {
    const cpt = (node.transition_cpt ?? []).map((r) => [...r]);
    cpt[row][col] = value;
    updateNodeTransitionCpt(node.id, cpt);
  };

  const clampedVeSlice = Math.min(veSlice, Math.max(0, timeSlices - 1));
  const veDistribution = virtualEvidence?.[clampedVeSlice];
  // Reused as a single-column, no-parents "node" so the virtual evidence
  // editor is just `CptTable` again -- one probability cell per state, the
  // exact shape pgmpy's `virtual_evidence` expects (see backend/schema.py).
  const veNode: NodeDefinition = {
    ...node,
    parents: [],
    cpt: node.states.map((state) => [veDistribution?.[state] ?? 0.5]),
  };
  const setVeCell = (row: number, _col: number, value: number) => {
    const distribution = { ...(veDistribution ?? Object.fromEntries(node.states.map((s) => [s, 0.5]))) };
    distribution[node.states[row]] = value;
    setVirtualEvidence(node.id, clampedVeSlice, distribution);
  };
  const veSetSlices = virtualEvidence ? Object.keys(virtualEvidence).map(Number).sort((a, b) => a - b) : [];

  const addState = () => {
    const name = newStateName.trim();
    if (!name || node.states.includes(name)) return;
    updateNodeStates(node.id, [...node.states, name]);
    setNewStateName("");
  };

  const removeState = (state: string) => {
    if (node.states.length <= 2) return;
    updateNodeStates(
      node.id,
      node.states.filter((s) => s !== state),
    );
  };

  const stochastic = isColumnStochastic(node.cpt);
  const transitionStochastic = node.transition_cpt ? isColumnStochastic(node.transition_cpt) : true;

  const handleMouseEnter = () => {
    hoverTimer.current = setTimeout(() => setShowExpandButton(true), HOVER_EXPAND_DELAY_MS);
  };
  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowExpandButton(false);
  };

  return (
    <InlineDrawer className={styles.drawer} separator open size="small" position="end">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss24Regular />}
              onClick={() => setSelectedNode(null)}
            />
          }
        >
          Inspector — {node.name ?? node.id}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={styles.section}>
          <div className={styles.identityRow}>
            <Field label="Identifier" hint="Unique key used by edges/CPT refs">
              <Input size="small" value={node.id} onChange={(_, data) => renameNode(node.id, data.value)} />
            </Field>
            <Field label="Display name" hint="Optional, shown on canvas">
              <Input
                size="small"
                placeholder={node.id}
                value={node.name ?? ""}
                onChange={(_, data) => setNodeName(node.id, data.value)}
              />
            </Field>
          </div>
        </div>

        <Divider />

        <div className={styles.section}>
          <Body1>Marginal &amp; evidence</Body1>
          <Caption1>Click a state to pin it as 100% evidence; click again to clear.</Caption1>
          {node.states.map((state) => {
            const prob = marginals?.[state] ?? 0;
            const isActive = evidenceState === state;
            return (
              <div key={state} className={styles.evidenceRow}>
                <Button
                  size="small"
                  appearance={isActive ? "primary" : "outline"}
                  icon={isActive ? <CheckmarkCircle24Filled /> : <CircleRegular />}
                  onClick={() => toggleEvidence(node.id, state)}
                  className={styles.evidenceLabel}
                >
                  {state}
                </Button>
                <ProgressBar
                  className={styles.evidenceBar}
                  value={prob}
                  max={1}
                  thickness="medium"
                  color={isActive ? "brand" : "success"}
                />
                <Caption1 className={styles.evidencePercent}>{(prob * 100).toFixed(1)}%</Caption1>
              </div>
            );
          })}
        </div>

        <Divider />

        <div className={styles.section}>
          <Body1>States</Body1>
          <div className={styles.statesRow}>
            <TagGroup
              size="small"
              dismissible={node.states.length > 2}
              onDismiss={(_, data) => removeState(data.value)}
            >
              {node.states.map((state) => (
                <Tag key={state} value={state} size="small">
                  {state}
                </Tag>
              ))}
            </TagGroup>
          </div>
          <div className={styles.toolbar}>
            <Input
              size="small"
              placeholder="New state name"
              value={newStateName}
              onChange={(_, data) => setNewStateName(data.value)}
              onKeyDown={(e) => e.key === "Enter" && addState()}
            />
            <Button size="small" icon={<AddCircle24Regular />} onClick={addState}>
              Add state
            </Button>
          </div>
        </div>

        <Divider />

        <div className={styles.section}>
          <Body1>Conditional Probability Table</Body1>
          <Caption1>
            {parentDefs.length > 0
              ? `${parentDefs.map((p) => p.id).join(" × ")}. Arrow keys/Enter move between cells, paste a block from Excel/Sheets, right-click a cell to auto-balance its column.`
              : "Root node — single unconditional column. Right-click a cell to auto-balance."}
          </Caption1>

          <div className={styles.toolbar}>
            <Tooltip
              content="Scale every column so it sums to 1.0 (uniform if a column is all zero) -- works on raw counts too"
              relationship="label"
            >
              <Button
                appearance="primary"
                size="small"
                icon={<Scales24Regular />}
                onClick={() => updateNodeCpt(node.id, normalizeCptColumns(node.cpt))}
              >
                Auto-Normalize
              </Button>
            </Tooltip>
            <Tooltip content="Set every state to equal probability" relationship="label">
              <Button
                size="small"
                icon={<SubtractCircle24Regular />}
                onClick={() => updateNodeCpt(node.id, uniformCpt(node.cpt))}
              >
                Uniform
              </Button>
            </Tooltip>
            <Tooltip content="Fill with random, normalized values" relationship="label">
              <Button
                size="small"
                icon={<ArrowShuffle24Regular />}
                onClick={() => updateNodeCpt(node.id, randomizeCpt(node.cpt))}
              >
                Randomize
              </Button>
            </Tooltip>
          </div>

          {!stochastic && (
            <MessageBar intent="warning" layout="multiline">
              <MessageBarBody>Columns shaded red don't sum to 1.0 yet.</MessageBarBody>
            </MessageBar>
          )}

          <div
            className={styles.tableOuter}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Tooltip content="Expand table" relationship="label">
              <Button
                className={mergeClasses(
                  styles.expandButton,
                  showExpandButton && styles.expandButtonVisible,
                )}
                appearance="secondary"
                size="small"
                icon={<ArrowExpand20Regular />}
                onClick={() => setExpandedOpen(true)}
              />
            </Tooltip>
            <CptTable
              node={node}
              parentDefs={parentDefs}
              onCellChange={setCell}
              onRenameState={(oldState, newState) => renameNodeState(node.id, oldState, newState)}
            />
          </div>
        </div>

        {node.temporal && (
          <>
            <Divider />

            <div className={styles.section}>
              <Body1 className={styles.temporalHeading}>
                <ClockRegular fontSize={16} />
                Temporal (Dynamic BN)
              </Body1>

              <Caption1>
                Transition CPT — P({node.id} at <strong>t</strong> | {node.id} at <strong>t-1</strong>
                {parentDefs.length > 0 ? `, and its parents at t` : ""}). Rows below are {node.id}&apos;s own states
                (its value at <strong>t</strong>, the slice being computed) — the column headers are what that&apos;s
                conditioned on: the &quot;(t-1)&quot; group is this node&apos;s <em>own</em> previous value, every
                &quot;(t)&quot; group is an ordinary parent&apos;s <em>current</em>-slice value.
              </Caption1>
              {!transitionStochastic && (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>Columns shaded red don&apos;t sum to 1.0 yet.</MessageBarBody>
                </MessageBar>
              )}
              <div className={styles.toolbar}>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<Scales24Regular />}
                  onClick={() => updateNodeTransitionCpt(node.id, normalizeCptColumns(node.transition_cpt ?? []))}
                >
                  Auto-Normalize
                </Button>
                <Button
                  size="small"
                  icon={<SubtractCircle24Regular />}
                  onClick={() => updateNodeTransitionCpt(node.id, uniformCpt(node.transition_cpt ?? []))}
                >
                  Uniform
                </Button>
                <Button
                  size="small"
                  icon={<ArrowShuffle24Regular />}
                  onClick={() => updateNodeTransitionCpt(node.id, randomizeCpt(node.transition_cpt ?? []))}
                >
                  Randomize
                </Button>
              </div>
              <CptTable
                node={{ ...node, cpt: node.transition_cpt ?? emptyCpt(node.states.length, 1) }}
                parentDefs={transitionParentDefs}
                onCellChange={setTransitionCell}
                onRenameState={(oldState, newState) => renameNodeState(node.id, oldState, newState)}
              />

              <Divider />

              <Body1>Virtual evidence</Body1>
              <Caption1>
                A soft likelihood, not a hard assignment — reweights belief at the chosen slice without asserting
                the state is certain (values needn&apos;t sum to 1).
              </Caption1>
              <div className={styles.veRow}>
                <Field label="Time slice">
                  <Dropdown
                    className={styles.veDropdown}
                    size="small"
                    value={`t = ${clampedVeSlice}`}
                    selectedOptions={[String(clampedVeSlice)]}
                    onOptionSelect={(_, data) => data.optionValue && setVeSlice(Number(data.optionValue))}
                  >
                    {Array.from({ length: timeSlices }, (_, t) => (
                      <Option key={t} value={String(t)} text={`t = ${t}`}>
                        t = {t}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              </div>
              <CptTable node={veNode} parentDefs={[]} onCellChange={setVeCell} onRenameState={() => {}} />

              {veSetSlices.length > 0 && (
                <div className={styles.veTagRow}>
                  <TagGroup size="small" dismissible onDismiss={(_, data) => removeVirtualEvidence(node.id, Number(data.value))}>
                    {veSetSlices.map((t) => (
                      <Tag key={t} value={String(t)} size="small">
                        t = {t}
                      </Tag>
                    ))}
                  </TagGroup>
                </div>
              )}

              <Divider />

              <div className={styles.temporalHeading}>
                <Body1>Trajectory</Body1>
                {isTemporalInferring && <Spinner size="tiny" />}
                {temporalMarginals && (
                  <Tooltip content="Expand chart" relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowExpand20Regular />}
                      onClick={() => setTrajectoryExpandedOpen(true)}
                    />
                  </Tooltip>
                )}
              </div>
              {temporalError && (
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>{temporalError}</MessageBarBody>
                </MessageBar>
              )}
              {temporalWarnings.map((w) => (
                <MessageBar key={w} intent="warning" layout="multiline">
                  <MessageBarBody>{w}</MessageBarBody>
                </MessageBar>
              ))}
              {temporalMarginals ? (
                <TrajectoryChart states={node.states} slices={temporalMarginals} />
              ) : (
                <Caption1>Marginals per time slice will appear here once inference runs.</Caption1>
              )}
            </div>
          </>
        )}
      </DrawerBody>

      <Dialog open={expandedOpen} onOpenChange={(_, data) => setExpandedOpen(data.open)}>
        <DialogSurface className={styles.dialogSurface}>
          <DialogBody className={styles.dialogBody}>
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Dismiss24Regular />}
                  onClick={() => setExpandedOpen(false)}
                />
              }
            >
              Conditional Probability Table — {node.name ?? node.id}
            </DialogTitle>
            <DialogContent className={styles.dialogContent}>
              <div className={styles.toolbar}>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<Scales24Regular />}
                  onClick={() => updateNodeCpt(node.id, normalizeCptColumns(node.cpt))}
                >
                  Auto-Normalize
                </Button>
                <Button
                  size="small"
                  icon={<SubtractCircle24Regular />}
                  onClick={() => updateNodeCpt(node.id, uniformCpt(node.cpt))}
                >
                  Uniform
                </Button>
                <Button
                  size="small"
                  icon={<ArrowShuffle24Regular />}
                  onClick={() => updateNodeCpt(node.id, randomizeCpt(node.cpt))}
                >
                  Randomize
                </Button>
              </div>
              <CptTable
                node={node}
                parentDefs={parentDefs}
                onCellChange={setCell}
                onRenameState={(oldState, newState) => renameNodeState(node.id, oldState, newState)}
                fill
              />
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {temporalMarginals && (
        <Dialog open={trajectoryExpandedOpen} onOpenChange={(_, data) => setTrajectoryExpandedOpen(data.open)}>
          <DialogSurface className={styles.dialogSurface}>
            <DialogBody>
              <DialogTitle
                action={
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss24Regular />}
                    onClick={() => setTrajectoryExpandedOpen(false)}
                  />
                }
              >
                Trajectory — {node.name ?? node.id}
              </DialogTitle>
              <DialogContent>
                <TrajectoryChart states={node.states} slices={temporalMarginals} size="large" />
              </DialogContent>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </InlineDrawer>
  );
}
