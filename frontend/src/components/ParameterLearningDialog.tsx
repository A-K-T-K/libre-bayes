import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { ArrowUploadRegular, DocumentTableRegular } from "@fluentui/react-icons";
import { useMemo, useRef, useState } from "react";

import { ApiError, learnParameters } from "../lib/api";
import type { Estimator, PriorType } from "../lib/types";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  surface: {
    width: "min(720px, 92vw)",
    maxWidth: "92vw",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "20px",
    border: `1.5px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
  },
  dropzoneActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  mappingCell: {
    minWidth: "160px",
  },
  estimatorRow: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  priorFields: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
});

/** Parses just the header row + first data row of a CSV client-side, for
 * the column-mapping preview -- the backend re-parses the whole thing
 * properly (pandas) when actually fitting. */
function parseCsvColumns(content: string): string[] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.split(",").map((c) => c.trim());
}

interface ParameterLearningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ParameterLearningDialog({ open, onOpenChange }: ParameterLearningDialogProps) {
  const styles = useStyles();
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edges = useNetworkStore((s) => s.edges);
  const updateNodeCpt = useNetworkStore((s) => s.updateNodeCpt);

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [estimator, setEstimator] = useState<Estimator>("mle");
  const [priorType, setPriorType] = useState<PriorType>("BDeu");
  const [equivalentSampleSize, setEquivalentSampleSize] = useState("5");
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rowCount: number; warnings: string[]; fittedCount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nodeIds = useMemo(() => Object.keys(nodeDefs), [nodeDefs]);

  const reset = () => {
    setCsvContent(null);
    setFileName(null);
    setColumns([]);
    setMapping({});
    setError(null);
    setResult(null);
  };

  const loadFile = async (file: File) => {
    const text = await file.text();
    const cols = parseCsvColumns(text);
    setCsvContent(text);
    setFileName(file.name);
    setColumns(cols);
    setError(null);
    setResult(null);
    // Auto-map by case-insensitive exact match, falling back to unmapped.
    const autoMap: Record<string, string> = {};
    for (const nodeId of nodeIds) {
      const match = cols.find((c) => c.toLowerCase() === nodeId.toLowerCase());
      if (match) autoMap[nodeId] = match;
    }
    setMapping(autoMap);
  };

  const handleSubmit = async () => {
    if (!csvContent) return;
    setError(null);
    setSubmitting(true);
    const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    try {
      const res = await learnParameters({
        nodes: Object.values(nodeDefs),
        edges,
        csv_content: csvContent,
        column_mapping: cleanMapping,
        estimator,
        prior_type: priorType,
        equivalent_sample_size: Number.parseFloat(equivalentSampleSize) || 5,
      });
      for (const cpt of res.cpts) {
        updateNodeCpt(cpt.node_id, cpt.cpt);
      }
      setResult({ rowCount: res.row_count, warnings: res.warnings, fittedCount: res.cpts.length });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        onOpenChange(data.open);
        if (!data.open) reset();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Fit Parameters from CSV</DialogTitle>
          <DialogContent className={styles.content}>
            <Caption1>
              Upload a dataset and estimate every mapped node's CPT directly from the data (Maximum Likelihood or
              Bayesian with a smoothing prior), instead of typing probabilities by hand.
            </Caption1>

            {error && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            {result && (
              <MessageBar intent="success" layout="multiline">
                <MessageBarBody>
                  Fit {result.fittedCount} node(s) from {result.rowCount} row(s).
                  {result.warnings.length > 0 && (
                    <>
                      {" "}
                      {result.warnings.length} warning(s):
                      <ul style={{ margin: "4px 0 0 0", paddingLeft: "18px" }}>
                        {result.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </MessageBarBody>
              </MessageBar>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])}
            />
            <div
              className={dragActive ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files[0]) void loadFile(e.dataTransfer.files[0]);
              }}
            >
              {fileName ? (
                <>
                  <DocumentTableRegular fontSize={28} />
                  <Body1>{fileName}</Body1>
                  <Caption1>{columns.length} column(s) found — click to choose a different file</Caption1>
                </>
              ) : (
                <>
                  <ArrowUploadRegular fontSize={28} />
                  <Body1>Click or drag a CSV file here</Body1>
                </>
              )}
            </div>

            {columns.length > 0 && (
              <>
                <Body1>Column mapping ({mappedCount} of {nodeIds.length} nodes mapped)</Body1>
                <Table size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Node</TableHeaderCell>
                      <TableHeaderCell>CSV column</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nodeIds.map((nodeId) => (
                      <TableRow key={nodeId}>
                        <TableCell>{nodeDefs[nodeId].name ?? nodeId}</TableCell>
                        <TableCell className={styles.mappingCell}>
                          <Dropdown
                            size="small"
                            placeholder="(not mapped)"
                            value={mapping[nodeId] ?? ""}
                            selectedOptions={mapping[nodeId] ? [mapping[nodeId]] : []}
                            onOptionSelect={(_, data) =>
                              setMapping((m) => ({ ...m, [nodeId]: data.optionValue ?? "" }))
                            }
                          >
                            {columns.map((col) => (
                              <Option key={col} value={col}>
                                {col}
                              </Option>
                            ))}
                          </Dropdown>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className={styles.estimatorRow}>
                  <RadioGroup
                    layout="horizontal"
                    value={estimator}
                    onChange={(_, data) => setEstimator(data.value as Estimator)}
                  >
                    <Radio value="mle" label="Maximum Likelihood" />
                    <Radio value="bayesian" label="Bayesian (smoothed)" />
                  </RadioGroup>
                </div>

                {estimator === "bayesian" && (
                  <div className={styles.priorFields}>
                    <Field label="Prior type">
                      <Dropdown
                        size="small"
                        value={priorType}
                        selectedOptions={[priorType]}
                        onOptionSelect={(_, data) => setPriorType(data.optionValue as PriorType)}
                      >
                        <Option value="BDeu">BDeu</Option>
                        <Option value="K2">K2</Option>
                        <Option value="dirichlet">Dirichlet</Option>
                      </Dropdown>
                    </Field>
                    <Field label="Equivalent sample size">
                      <Input
                        size="small"
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={equivalentSampleSize}
                        onChange={(_, d) => setEquivalentSampleSize(d.value)}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              appearance="primary"
              disabled={!csvContent || mappedCount === 0 || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Learning…" : "Learn Parameters"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
