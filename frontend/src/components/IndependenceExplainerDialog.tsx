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
  Field,
  MessageBar,
  MessageBarBody,
  Option,
  Tag,
  TagGroup,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, DismissCircleRegular } from "@fluentui/react-icons";
import { useState } from "react";

import { ApiError, queryIndependence, queryMarkovBlanket } from "../lib/api";
import type { IndependenceResponse, MarkovBlanketResponse } from "../lib/types";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  surface: {
    width: "min(640px, 92vw)",
    maxWidth: "92vw",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  row: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  resultCard: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  formal: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "14px",
  },
  blanketSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
});

interface IndependenceExplainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IndependenceExplainerDialog({ open, onOpenChange }: IndependenceExplainerDialogProps) {
  const styles = useStyles();
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edges = useNetworkStore((s) => s.edges);
  const setSelectionIds = useNetworkStore((s) => s.setSelectionIds);
  const nodeIds = Object.keys(nodeDefs);

  const [nodeA, setNodeA] = useState("");
  const [nodeB, setNodeB] = useState("");
  const [observed, setObserved] = useState<string[]>([]);
  const [result, setResult] = useState<IndependenceResponse | null>(null);
  const [blanketNode, setBlanketNode] = useState("");
  const [blanket, setBlanket] = useState<MarkovBlanketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async () => {
    if (!nodeA || !nodeB || nodeA === nodeB) return;
    setError(null);
    setLoading(true);
    try {
      const res = await queryIndependence({
        nodes: Object.values(nodeDefs),
        edges,
        node_a: nodeA,
        node_b: nodeB,
        observed,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const runBlanket = async () => {
    if (!blanketNode) return;
    setError(null);
    setLoading(true);
    try {
      const res = await queryMarkovBlanket({ nodes: Object.values(nodeDefs), edges, node: blanketNode });
      setBlanket(res);
      setSelectionIds([blanketNode, ...res.parents, ...res.children, ...res.spouses]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Active Graph Theory</DialogTitle>
          <DialogContent className={styles.content}>
            <Caption1>
              d-separation between two nodes, and a node's Markov blanket -- read directly off the current graph
              structure, no data needed.
            </Caption1>

            {error && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}

            <Body1>Independence check</Body1>
            <div className={styles.row}>
              <Field label="Node A">
                <Dropdown
                  size="small"
                  value={nodeA}
                  selectedOptions={nodeA ? [nodeA] : []}
                  onOptionSelect={(_, d) => setNodeA(d.optionValue ?? "")}
                >
                  {nodeIds.map((id) => (
                    <Option key={id}>{id}</Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Node B">
                <Dropdown
                  size="small"
                  value={nodeB}
                  selectedOptions={nodeB ? [nodeB] : []}
                  onOptionSelect={(_, d) => setNodeB(d.optionValue ?? "")}
                >
                  {nodeIds.map((id) => (
                    <Option key={id}>{id}</Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Given (observed)">
                <Dropdown
                  size="small"
                  multiselect
                  placeholder="(none)"
                  selectedOptions={observed}
                  onOptionSelect={(_, d) => setObserved(d.selectedOptions)}
                >
                  {nodeIds
                    .filter((id) => id !== nodeA && id !== nodeB)
                    .map((id) => (
                      <Option key={id}>{id}</Option>
                    ))}
                </Dropdown>
              </Field>
              <Button
                size="small"
                appearance="primary"
                disabled={!nodeA || !nodeB || nodeA === nodeB || loading}
                onClick={() => void runCheck()}
              >
                Check
              </Button>
            </div>

            {result && (
              <div className={styles.resultCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {result.d_separated ? (
                    <CheckmarkCircleRegular color={tokens.colorPaletteGreenForeground1} />
                  ) : (
                    <DismissCircleRegular color={tokens.colorPaletteRedForeground1} />
                  )}
                  <Text weight="semibold">{result.d_separated ? "d-separated (independent)" : "Not d-separated (dependent)"}</Text>
                </div>
                <Text className={styles.formal}>{result.formal}</Text>
                <Caption1>{result.explanation}</Caption1>
              </div>
            )}

            <Divider />

            <Body1>Markov blanket</Body1>
            <div className={styles.row}>
              <Field label="Node">
                <Dropdown
                  size="small"
                  value={blanketNode}
                  selectedOptions={blanketNode ? [blanketNode] : []}
                  onOptionSelect={(_, d) => setBlanketNode(d.optionValue ?? "")}
                >
                  {nodeIds.map((id) => (
                    <Option key={id}>{id}</Option>
                  ))}
                </Dropdown>
              </Field>
              <Button size="small" appearance="primary" disabled={!blanketNode || loading} onClick={() => void runBlanket()}>
                Show blanket
              </Button>
            </div>

            {blanket && (
              <div className={styles.blanketSection}>
                <Caption1>Highlighted on canvas — parents, children, and co-parents ("spouses") of {blanketNode}.</Caption1>
                <TagGroup>
                  {blanket.parents.map((p) => (
                    <Tag key={`p-${p}`} appearance="brand">
                      parent: {p}
                    </Tag>
                  ))}
                  {blanket.children.map((c) => (
                    <Tag key={`c-${c}`} appearance="brand">
                      child: {c}
                    </Tag>
                  ))}
                  {blanket.spouses.map((s) => (
                    <Tag key={`s-${s}`} appearance="brand">
                      spouse: {s}
                    </Tag>
                  ))}
                  {blanket.parents.length + blanket.children.length + blanket.spouses.length === 0 && (
                    <Caption1>This node's Markov blanket is empty (isolated node).</Caption1>
                  )}
                </TagGroup>
              </div>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
