import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Switch,
  makeStyles,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, PlayRegular } from "@fluentui/react-icons";
import { useState } from "react";

import { ApiError, learnParameters, simulate } from "../lib/api";
import { saveTextFile } from "../lib/saveFile";
import { useNetworkStore } from "../store/useNetworkStore";

const useStyles = makeStyles({
  surface: {
    width: "min(520px, 92vw)",
    maxWidth: "92vw",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minWidth: 0,
  },
  messageBar: {
    minWidth: 0,
    maxWidth: "100%",
  },
  messageBody: {
    minWidth: 0,
    overflowWrap: "break-word",
    wordBreak: "break-word",
  },
});

const SAMPLE_COUNTS = [100, 1_000, 10_000];

interface SimulateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Forward (or interventional) sampling: generate a synthetic CSV from the
 * current network, either to download or to immediately feed back into
 * parameter learning as a round-trip sanity check. */
export function SimulateDialog({ open, onOpenChange }: SimulateDialogProps) {
  const styles = useStyles();
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edges = useNetworkStore((s) => s.edges);
  const interventions = useNetworkStore((s) => s.interventions);
  const evidence = useNetworkStore((s) => s.evidence);
  const updateNodeCpt = useNetworkStore((s) => s.updateNodeCpt);

  const [nSamples, setNSamples] = useState(1000);
  const [useCurrentConditions, setUseCurrentConditions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const activeConditionCount = Object.keys(interventions).length + Object.keys(evidence).length;

  const runSimulate = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    setProgress(0.3);
    try {
      const res = await simulate({
        nodes: Object.values(nodeDefs),
        edges,
        n_samples: nSamples,
        do: useCurrentConditions ? interventions : undefined,
        evidence: useCurrentConditions ? evidence : undefined,
      });
      setProgress(1);
      await saveTextFile(res.csv_content, `synthetic_${nSamples}.csv`, "text/csv;charset=utf-8;");
      setStatus(`Downloaded ${res.row_count} sampled rows.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const simulateAndTrainBack = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    setProgress(0.2);
    try {
      const simRes = await simulate({
        nodes: Object.values(nodeDefs),
        edges,
        n_samples: nSamples,
        do: useCurrentConditions ? interventions : undefined,
        evidence: useCurrentConditions ? evidence : undefined,
      });
      setProgress(0.6);
      // The simulated CSV's columns are exactly the node ids, so the
      // mapping back into parameter learning is always the identity map.
      const identityMapping = Object.fromEntries(Object.keys(nodeDefs).map((id) => [id, id]));
      const learnRes = await learnParameters({
        nodes: Object.values(nodeDefs),
        edges,
        csv_content: simRes.csv_content,
        column_mapping: identityMapping,
        estimator: "mle",
      });
      for (const cpt of learnRes.cpts) {
        updateNodeCpt(cpt.node_id, cpt.cpt);
      }
      setProgress(1);
      setStatus(
        `Simulated ${simRes.row_count} rows and re-fit ${learnRes.cpts.length} node(s) from them — a full ` +
          `generate → learn round trip.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Synthetic Dataset</DialogTitle>
          <DialogContent className={styles.content}>
            <Caption1>
              Forward-samples the current network into a CSV. If any do()-interventions or evidence are active, they
              apply to the sampling too (turn that off to sample from the network as-is).
            </Caption1>

            {error && (
              <MessageBar intent="error" layout="multiline" className={styles.messageBar}>
                <MessageBarBody className={styles.messageBody}>{error}</MessageBarBody>
              </MessageBar>
            )}
            {status && (
              <MessageBar intent="success" layout="multiline" className={styles.messageBar}>
                <MessageBarBody className={styles.messageBody}>{status}</MessageBarBody>
              </MessageBar>
            )}
            {busy && <ProgressBar value={progress} />}

            <Field label="Sample count">
              <RadioGroup
                layout="horizontal"
                value={String(nSamples)}
                onChange={(_, data) => setNSamples(Number.parseInt(data.value, 10))}
              >
                {SAMPLE_COUNTS.map((n) => (
                  <Radio key={n} value={String(n)} label={n.toLocaleString()} />
                ))}
              </RadioGroup>
            </Field>

            <Switch
              checked={useCurrentConditions}
              onChange={(_, data) => setUseCurrentConditions(data.checked)}
              label={
                activeConditionCount > 0
                  ? `Apply ${activeConditionCount} active evidence/intervention setting(s) while sampling`
                  : "Apply active evidence/interventions while sampling (none currently set)"
              }
            />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button icon={<ArrowDownloadRegular />} disabled={busy} onClick={() => void runSimulate()}>
              Download CSV
            </Button>
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              disabled={busy}
              onClick={() => void simulateAndTrainBack()}
            >
              Simulate &amp; Train Back
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
