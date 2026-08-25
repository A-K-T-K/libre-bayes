import { Badge, Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircleRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { useMemo } from "react";

import { isValidDag } from "../lib/dag";
import { MODES } from "../lib/modes";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "3px 12px",
    height: "24px",
    flexShrink: 0,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  divider: {
    width: "1px",
    height: "12px",
    backgroundColor: tokens.colorNeutralStroke2,
  },
  spacer: {
    flex: 1,
  },
});

export function StatusBar() {
  const styles = useStyles();
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edges = useNetworkStore((s) => s.edges);
  const selectedNodeId = useNetworkStore((s) => s.selectedNodeId);
  const evidenceCount = useNetworkStore((s) => Object.keys(s.evidence).length);
  const tool = useNetworkStore((s) => s.tool);
  const mode = useNetworkStore((s) => s.mode);

  const nodeIds = useMemo(() => Object.keys(nodeDefs), [nodeDefs]);
  const dagValid = useMemo(() => isValidDag(nodeIds, edges), [nodeIds, edges]);

  const selectedNode = selectedNodeId ? nodeDefs[selectedNodeId] : undefined;
  const modeHint = MODES.find((m) => m.value === mode)?.hint;

  return (
    <div className={styles.bar}>
      <Badge
        appearance="tint"
        size="small"
        color={dagValid ? "success" : "danger"}
        icon={dagValid ? <CheckmarkCircleRegular /> : <ErrorCircleRegular />}
      >
        {dagValid ? "Valid DAG" : "Cycle detected"}
      </Badge>

      <div className={styles.divider} />

      <Text size={200}>{nodeIds.length} node{nodeIds.length === 1 ? "" : "s"}</Text>
      <Text size={200}>{edges.length} edge{edges.length === 1 ? "" : "s"}</Text>
      {evidenceCount > 0 && (
        <Text size={200}>
          {evidenceCount} evidence set
        </Text>
      )}

      <div className={styles.divider} />

      <Text size={200} truncate>
        {selectedNode
          ? `${selectedNode.id} — ${selectedNode.states.length} states, ${selectedNode.parents.length} parent${selectedNode.parents.length === 1 ? "" : "s"}`
          : "No node selected"}
      </Text>

      {modeHint && (
        <>
          <div className={styles.divider} />
          <Text size={200} truncate>
            {modeHint}
          </Text>
        </>
      )}

      <div className={styles.spacer} />

      <Text size={200}>Tool: {tool}</Text>
    </div>
  );
}
