import {
  Body1,
  Button,
  Caption1,
  InlineDrawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Input,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircle16Filled, ChevronLeft20Regular, SearchRegular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";

import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  drawer: {
    width: "clamp(200px, 16vw, 260px)",
  },
  search: {
    width: "100%",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginTop: "8px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    backgroundColor: "transparent",
    border: "none",
    textAlign: "left",
    width: "100%",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  rowSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    "&:hover": {
      backgroundColor: tokens.colorBrandBackground2,
    },
  },
  rowLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    padding: "8px",
  },
  reopenButton: {
    position: "absolute",
    left: 0,
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 5,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
});

export function NodeListPanel() {
  const styles = useStyles();
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const selectedNodeId = useNetworkStore((s) => s.selectedNodeId);
  const setSelectedNode = useNetworkStore((s) => s.setSelectedNode);
  const evidence = useNetworkStore((s) => s.evidence);
  const showNodePanel = useNetworkStore((s) => s.showNodePanel);
  const toggleNodePanel = useNetworkStore((s) => s.toggleNodePanel);

  const [query, setQuery] = useState("");

  const nodes = useMemo(() => {
    const all = Object.values(nodeDefs).sort((a, b) => a.id.localeCompare(b.id));
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((n) => n.id.toLowerCase().includes(q));
  }, [nodeDefs, query]);

  if (!showNodePanel) {
    return (
      <Button
        className={styles.reopenButton}
        appearance="subtle"
        icon={<ChevronLeft20Regular style={{ transform: "rotate(180deg)" }} />}
        onClick={toggleNodePanel}
        title="Show node panel"
      />
    );
  }

  return (
    <InlineDrawer className={styles.drawer} separator open position="start">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" icon={<ChevronLeft20Regular />} onClick={toggleNodePanel} />
          }
        >
          Nodes
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <Input
          className={styles.search}
          contentBefore={<SearchRegular />}
          placeholder="Search nodes…"
          value={query}
          onChange={(_, data) => setQuery(data.value)}
        />
        <div className={styles.list}>
          {nodes.length === 0 && <Caption1 className={styles.empty}>No matching nodes</Caption1>}
          {nodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const hasEvidence = evidence[node.id] !== undefined;
            return (
              <button
                key={node.id}
                type="button"
                className={mergeClasses(styles.row, isSelected && styles.rowSelected)}
                onClick={() => setSelectedNode(isSelected ? null : node.id)}
              >
                <Body1 className={styles.rowLabel}>{node.id}</Body1>
                {hasEvidence && <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} />}
              </button>
            );
          })}
        </div>
      </DrawerBody>
    </InlineDrawer>
  );
}
