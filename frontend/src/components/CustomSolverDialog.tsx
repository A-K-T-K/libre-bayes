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
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";

import { ApiError, registerCustomSolver } from "../lib/api";
import { useNetworkStore } from "../store/useNetworkStore";

export const CUSTOM_SOLVER_OPTION_VALUE = "__custom__";

const DEFAULT_CODE = `def solve(payload, model, targets):
    """
    payload: NetworkPayload -- payload.evidence, payload.options.n_samples, ...
    model:   a ready pgmpy DiscreteBayesianNetwork (nodes/edges/CPDs attached)
    targets: node ids to compute a marginal for

    Return {node_id: {state_name: probability}} for every id in targets.
    """
    from pgmpy.inference import VariableElimination

    infer = VariableElimination(model)
    marginals = {}
    for var in targets:
        factor = infer.query(variables=[var], evidence=payload.evidence or None, show_progress=False)
        states = factor.state_names[var]
        marginals[var] = {s: float(p) for s, p in zip(states, factor.values)}
    return marginals
`;

const useStyles = makeStyles({
  surface: {
    width: "min(720px, 92vw)",
    maxWidth: "92vw",
  },
  row: {
    display: "flex",
    gap: "8px",
  },
  code: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "12px",
    minHeight: "260px",
  },
  code_textarea: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  help: {
    color: tokens.colorNeutralForeground3,
  },
});

interface CustomSolverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: (name: string) => void;
}

export function CustomSolverDialog({ open, onOpenChange, onRegistered }: CustomSolverDialogProps) {
  const styles = useStyles();
  const setSolvers = useNetworkStore((s) => s.setSolvers);

  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setLabel("");
    setDescription("");
    setCode(DEFAULT_CODE);
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim() || !label.trim() || !code.trim()) {
      setError("Name, label, and code are all required.");
      return;
    }
    setSubmitting(true);
    try {
      const solvers = await registerCustomSolver({
        name: name.trim(),
        label: label.trim(),
        description: description.trim(),
        code,
      });
      setSolvers(solvers);
      onRegistered(name.trim());
      reset();
      onOpenChange(false);
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
        if (!data.open) setError(null);
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Custom Inference Method</DialogTitle>
          <DialogContent>
            <Body1>
              Write a Python function <code>solve(payload, model, targets)</code> and it's
              registered as a real plugin file (<code>backend/solvers/custom_&lt;name&gt;.py</code>) --
              it survives restarts and appears in the algorithm dropdown immediately.
            </Body1>
            <Caption1 className={styles.help}>
              Runs with full backend privileges (same trust model as any local script) and a
              30s timeout. Full contract: <code>backend/solvers/SCHEMA.md</code>.
            </Caption1>

            {error && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}

            <div className={styles.row}>
              <Field label="Name (id)" required style={{ flex: 1 }}>
                <Input
                  placeholder="my_solver"
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                />
              </Field>
              <Field label="Label" required style={{ flex: 2 }}>
                <Input
                  placeholder="My Custom Solver"
                  value={label}
                  onChange={(_, d) => setLabel(d.value)}
                />
              </Field>
            </div>

            <Field label="Description">
              <Input
                placeholder="One sentence about what makes this solver useful"
                value={description}
                onChange={(_, d) => setDescription(d.value)}
              />
            </Field>

            <Field label="Code">
              <Textarea
                className={styles.code}
                textarea={{ className: styles.code_textarea }}
                value={code}
                onChange={(_, d) => setCode(d.value)}
                resize="vertical"
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={submitting} onClick={() => void handleSubmit()}>
              {submitting ? "Registering…" : "Register Solver"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
