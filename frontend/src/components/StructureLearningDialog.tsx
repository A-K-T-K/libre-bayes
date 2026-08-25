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
  MessageBar,
  MessageBarBody,
  Option,
  Tag,
  TagGroup,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, ArrowUploadRegular, DocumentTableRegular } from "@fluentui/react-icons";
import { useRef, useState } from "react";

import { ApiError, learnStructure } from "../lib/api";
import type { ScoringMethod, StructureAlgorithm } from "../lib/types";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  surface: {
    width: "min(680px, 92vw)",
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
    padding: "18px",
    border: `1.5px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  constraintAdd: {
    display: "flex",
    gap: "6px",
    alignItems: "flex-end",
  },
});

const ALGORITHMS: { value: StructureAlgorithm; label: string }[] = [
  { value: "hillclimb", label: "Hill Climb (score-based)" },
  { value: "pc", label: "PC (constraint-based)" },
  { value: "treesearch", label: "Tree Search (Chow-Liu)" },
];

interface StructureLearningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StructureLearningDialog({ open, onOpenChange }: StructureLearningDialogProps) {
  const styles = useStyles();
  const loadNetwork = useNetworkStore((s) => s.loadNetwork);
  const applyAutoLayout = useNetworkStore((s) => s.applyAutoLayout);
  const options = useNetworkStore((s) => s.options);

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [algorithm, setAlgorithm] = useState<StructureAlgorithm>("hillclimb");
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>("bic");
  const [requiredFrom, setRequiredFrom] = useState("");
  const [requiredTo, setRequiredTo] = useState("");
  const [forbiddenFrom, setForbiddenFrom] = useState("");
  const [forbiddenTo, setForbiddenTo] = useState("");
  const [requiredEdges, setRequiredEdges] = useState<[string, string][]>([]);
  const [forbiddenEdges, setForbiddenEdges] = useState<[string, string][]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsvContent(null);
    setFileName(null);
    setColumns([]);
    setRequiredEdges([]);
    setForbiddenEdges([]);
    setError(null);
    setWarnings([]);
  };

  const loadFile = async (file: File) => {
    const text = await file.text();
    const cols = (text.split(/\r?\n/, 1)[0] ?? "").split(",").map((c) => c.trim());
    setCsvContent(text);
    setFileName(file.name);
    setColumns(cols);
    setError(null);
    setWarnings([]);
  };

  const handleSubmit = async () => {
    if (!csvContent) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await learnStructure({
        csv_content: csvContent,
        algorithm,
        scoring_method: scoringMethod,
        required_edges: requiredEdges,
        forbidden_edges: forbiddenEdges,
      });
      loadNetwork({ nodes: res.nodes, edges: res.edges, evidence: {}, options });
      applyAutoLayout();
      setWarnings(res.warnings);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

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
          <DialogTitle>Auto-Discover DAG Structure</DialogTitle>
          <DialogContent className={styles.content}>
            <Caption1>
              Learns nodes and edges directly from a dataset — replaces the current canvas. States come from each
              column's unique values, and CPTs are fit with Maximum Likelihood.
            </Caption1>

            {error && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            {warnings.length > 0 && (
              <MessageBar intent="warning" layout="multiline">
                <MessageBarBody>{warnings.join("; ")}</MessageBarBody>
              </MessageBar>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])}
            />
            <div className={styles.dropzone} onClick={() => fileInputRef.current?.click()}>
              {fileName ? (
                <>
                  <DocumentTableRegular fontSize={26} />
                  <Body1>{fileName}</Body1>
                  <Caption1>{columns.length} column(s) — click to choose a different file</Caption1>
                </>
              ) : (
                <>
                  <ArrowUploadRegular fontSize={26} />
                  <Body1>Click to choose a CSV file</Body1>
                </>
              )}
            </div>

            <div className={styles.row}>
              <Field label="Algorithm">
                <Dropdown
                  size="small"
                  value={ALGORITHMS.find((a) => a.value === algorithm)?.label}
                  selectedOptions={[algorithm]}
                  onOptionSelect={(_, data) => setAlgorithm(data.optionValue as StructureAlgorithm)}
                >
                  {ALGORITHMS.map((a) => (
                    <Option key={a.value} value={a.value}>
                      {a.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              {algorithm === "hillclimb" && (
                <Field label="Scoring method">
                  <Dropdown
                    size="small"
                    value={scoringMethod.toUpperCase()}
                    selectedOptions={[scoringMethod]}
                    onOptionSelect={(_, data) => setScoringMethod(data.optionValue as ScoringMethod)}
                  >
                    <Option value="bic">BIC</Option>
                    <Option value="k2">K2</Option>
                    <Option value="bdeu">BDeu</Option>
                  </Dropdown>
                </Field>
              )}
            </div>

            {columns.length > 0 && algorithm !== "treesearch" && (
              <>
                <Body1>Prior knowledge (optional)</Body1>
                <div className={styles.constraintAdd}>
                  <Field label="Required edge: from">
                    <Dropdown
                      size="small"
                      value={requiredFrom}
                      selectedOptions={requiredFrom ? [requiredFrom] : []}
                      onOptionSelect={(_, d) => setRequiredFrom(d.optionValue ?? "")}
                    >
                      {columns.map((c) => (
                        <Option key={c}>{c}</Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="to">
                    <Dropdown
                      size="small"
                      value={requiredTo}
                      selectedOptions={requiredTo ? [requiredTo] : []}
                      onOptionSelect={(_, d) => setRequiredTo(d.optionValue ?? "")}
                    >
                      {columns.map((c) => (
                        <Option key={c}>{c}</Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Button
                    size="small"
                    icon={<AddRegular />}
                    disabled={!requiredFrom || !requiredTo || requiredFrom === requiredTo}
                    onClick={() => {
                      setRequiredEdges((e) => [...e, [requiredFrom, requiredTo]]);
                      setRequiredFrom("");
                      setRequiredTo("");
                    }}
                  >
                    Add required
                  </Button>
                </div>
                {requiredEdges.length > 0 && (
                  <TagGroup onDismiss={(_, d) => setRequiredEdges((e) => e.filter((_, i) => String(i) !== d.value))}>
                    {requiredEdges.map(([from, to], i) => (
                      <Tag key={i} value={String(i)}>
                        {from} → {to} (required)
                      </Tag>
                    ))}
                  </TagGroup>
                )}

                <div className={styles.constraintAdd}>
                  <Field label="Forbidden edge: from">
                    <Dropdown
                      size="small"
                      value={forbiddenFrom}
                      selectedOptions={forbiddenFrom ? [forbiddenFrom] : []}
                      onOptionSelect={(_, d) => setForbiddenFrom(d.optionValue ?? "")}
                    >
                      {columns.map((c) => (
                        <Option key={c}>{c}</Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="to">
                    <Dropdown
                      size="small"
                      value={forbiddenTo}
                      selectedOptions={forbiddenTo ? [forbiddenTo] : []}
                      onOptionSelect={(_, d) => setForbiddenTo(d.optionValue ?? "")}
                    >
                      {columns.map((c) => (
                        <Option key={c}>{c}</Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Button
                    size="small"
                    icon={<AddRegular />}
                    disabled={!forbiddenFrom || !forbiddenTo || forbiddenFrom === forbiddenTo}
                    onClick={() => {
                      setForbiddenEdges((e) => [...e, [forbiddenFrom, forbiddenTo]]);
                      setForbiddenFrom("");
                      setForbiddenTo("");
                    }}
                  >
                    Add forbidden
                  </Button>
                </div>
                {forbiddenEdges.length > 0 && (
                  <TagGroup onDismiss={(_, d) => setForbiddenEdges((e) => e.filter((_, i) => String(i) !== d.value))}>
                    {forbiddenEdges.map(([from, to], i) => (
                      <Tag key={i} value={String(i)}>
                        {from} ↛ {to} (forbidden)
                      </Tag>
                    ))}
                  </TagGroup>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={!csvContent || submitting} onClick={() => void handleSubmit()}>
              {submitting ? "Discovering…" : "Discover Structure"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
