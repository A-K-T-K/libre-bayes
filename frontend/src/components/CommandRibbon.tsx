import {
  Badge,
  Button,
  Divider,
  Dropdown,
  Input,
  Option,
  Spinner,
  Switch,
  ToggleButton,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddCircle24Regular,
  ArrowAutofitContent24Regular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  ArrowUploadRegular,
  BranchForkHintRegular,
  BroomRegular,
  CircleRegular,
  ConnectedRegular,
  CursorRegular,
  Delete24Regular,
  FlowchartRegular,
  Play24Filled,
  StarRegular,
  TableSimpleRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";

import { redo, undo, useNetworkStore, useTemporalStore } from "../store/useNetworkStore";
import { shortSolverLabel } from "../lib/types";
import { CUSTOM_SOLVER_OPTION_VALUE, CustomSolverDialog } from "./CustomSolverDialog";
import { IndependenceExplainerDialog } from "./IndependenceExplainerDialog";
import { ModeToggle } from "./ModeToggle";
import { ParameterLearningDialog } from "./ParameterLearningDialog";
import { SimulateDialog } from "./SimulateDialog";
import { StructureLearningDialog } from "./StructureLearningDialog";

const useStyles = makeStyles({
  ribbon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    gap: "8px",
    flexWrap: "wrap",
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  dropdown: {
    width: "clamp(170px, 15vw, 240px)",
    minHeight: 0,
  },
  sampleField: {
    width: "clamp(80px, 7vw, 110px)",
    minHeight: 0,
  },
  diagnostics: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
});

export function CommandRibbon() {
  const styles = useStyles();
  const options = useNetworkStore((s) => s.options);
  const setOptions = useNetworkStore((s) => s.setOptions);
  const addNode = useNetworkStore((s) => s.addNode);
  const applyAutoLayout = useNetworkStore((s) => s.applyAutoLayout);
  const clearEvidence = useNetworkStore((s) => s.clearEvidence);
  const resetCanvas = useNetworkStore((s) => s.resetCanvas);
  const isInferring = useNetworkStore((s) => s.isInferring);
  const latencyMs = useNetworkStore((s) => s.latencyMs);
  const methodUsed = useNetworkStore((s) => s.methodUsed);
  const inferError = useNetworkStore((s) => s.inferError);
  const evidenceCount = useNetworkStore((s) => Object.keys(s.evidence).length);
  const tool = useNetworkStore((s) => s.tool);
  const setTool = useNetworkStore((s) => s.setTool);
  const canUndo = useTemporalStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalStore((s) => s.futureStates.length > 0);
  const autoInfer = useNetworkStore((s) => s.autoInfer);
  const setAutoInfer = useNetworkStore((s) => s.setAutoInfer);
  const inferNow = useNetworkStore((s) => s.inferNow);
  const stopInference = useNetworkStore((s) => s.stopInference);
  const solvers = useNetworkStore((s) => s.solvers);
  const mapAssignment = useNetworkStore((s) => s.mapAssignment);
  const mapProbability = useNetworkStore((s) => s.mapProbability);
  const isMapQuerying = useNetworkStore((s) => s.isMapQuerying);
  const runMapQuery = useNetworkStore((s) => s.runMapQuery);
  const clearMapResult = useNetworkStore((s) => s.clearMapResult);
  const dbnEnabled = useNetworkStore((s) => s.dbnEnabled);
  const setDbnEnabled = useNetworkStore((s) => s.setDbnEnabled);
  const timeSlices = useNetworkStore((s) => s.timeSlices);
  const setTimeSlices = useNetworkStore((s) => s.setTimeSlices);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [learnParamsOpen, setLearnParamsOpen] = useState(false);
  const [structureLearnOpen, setStructureLearnOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const selectedSolver = useMemo(
    () => solvers.find((s) => s.name === options.method),
    [solvers, options.method],
  );
  const isApproximate = selectedSolver?.supports_sampling ?? false;
  const methodShort = useMemo(
    () => (methodUsed ? shortSolverLabel(solvers.find((s) => s.name === methodUsed)?.label ?? methodUsed) : null),
    [methodUsed, solvers],
  );

  return (
    <div className={styles.ribbon}>
      <div className={styles.group}>
        <ModeToggle />
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip content="Select tool — click to select, drag to move nodes" relationship="label">
          <ToggleButton
            size="small"
            appearance="subtle"
            checked={tool === "select"}
            icon={<CursorRegular />}
            onClick={() => setTool("select")}
          />
        </Tooltip>
        <Tooltip content="Node tool — drag on the canvas to draw a node, or click to place a default one" relationship="label">
          <ToggleButton
            size="small"
            appearance="subtle"
            checked={tool === "node"}
            icon={<CircleRegular />}
            onClick={() => setTool("node")}
          />
        </Tooltip>
        <Tooltip content="Link tool — drag from anywhere inside one node to another to connect them" relationship="label">
          <ToggleButton
            size="small"
            appearance="subtle"
            checked={tool === "link"}
            icon={<ConnectedRegular />}
            onClick={() => setTool("link")}
          />
        </Tooltip>
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip content="Undo (Ctrl+Z)" relationship="label">
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowUndoRegular />}
            disabled={!canUndo}
            onClick={undo}
          />
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)" relationship="label">
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowRedoRegular />}
            disabled={!canRedo}
            onClick={redo}
          />
        </Tooltip>
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip content="Inference algorithm" relationship="label">
          <Dropdown
            size="small"
            className={styles.dropdown}
            value={selectedSolver?.label ?? options.method}
            selectedOptions={[options.method]}
            onOptionSelect={(_, data) => {
              if (data.optionValue === CUSTOM_SOLVER_OPTION_VALUE) {
                setCustomDialogOpen(true);
              } else if (data.optionValue) {
                setOptions({ method: data.optionValue });
              }
            }}
          >
            {solvers.map((solver) => (
              <Option key={solver.name} value={solver.name} text={solver.label}>
                {solver.label}
              </Option>
            ))}
            <Option value={CUSTOM_SOLVER_OPTION_VALUE} text="+ Custom Inference Method…">
              + Custom Inference Method…
            </Option>
          </Dropdown>
        </Tooltip>
        <CustomSolverDialog
          open={customDialogOpen}
          onOpenChange={setCustomDialogOpen}
          onRegistered={(name) => setOptions({ method: name })}
        />

        {isApproximate && (
          <Tooltip content="Samples (N)" relationship="label">
            <Input
              size="small"
              className={styles.sampleField}
              type="number"
              min={1000}
              max={50000}
              step={1000}
              value={String(options.n_samples ?? 10000)}
              onChange={(_, data) => {
                const parsed = Number.parseInt(data.value, 10);
                if (Number.isFinite(parsed)) {
                  setOptions({ n_samples: Math.min(50000, Math.max(1000, parsed)) });
                }
              }}
            />
          </Tooltip>
        )}

        <Tooltip
          content={autoInfer ? "Auto-infer on every change" : "Auto-infer paused — use Infer Now"}
          relationship="label"
        >
          <Switch
            checked={autoInfer}
            onChange={(_, data) => setAutoInfer(data.checked)}
            label="Auto Infer"
          />
        </Tooltip>

        {isInferring ? (
          <Tooltip content="Stop the running inference" relationship="label">
            <Button
              size="small"
              appearance="outline"
              icon={<Spinner size="extra-tiny" />}
              onClick={stopInference}
            >
              Stop
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content="Run inference once, right now" relationship="label">
            <Button size="small" appearance="primary" icon={<Play24Filled />} onClick={inferNow}>
              Infer Now
            </Button>
          </Tooltip>
        )}
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip
          content={
            dbnEnabled
              ? "Dynamic BN — right-click a node to mark it temporal (t−1 → t)"
              : "Enable to author a Dynamic Bayesian Network (temporal nodes, time-slice unrolling)"
          }
          relationship="label"
        >
          <Switch checked={dbnEnabled} onChange={(_, data) => setDbnEnabled(data.checked)} label="Dynamic BN" />
        </Tooltip>
        {dbnEnabled && (
          <Tooltip content="How many time slices to unroll for temporal inference / the Inspector's trajectory plot" relationship="label">
            <Input
              size="small"
              className={styles.sampleField}
              type="number"
              min={1}
              max={50}
              value={String(timeSlices)}
              onChange={(_, data) => {
                const parsed = Number.parseInt(data.value, 10);
                if (Number.isFinite(parsed)) setTimeSlices(parsed);
              }}
            />
          </Tooltip>
        )}
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip content="Add a new node to the canvas" relationship="label">
          <Button size="small" icon={<AddCircle24Regular />} onClick={addNode}>
            Add Node
          </Button>
        </Tooltip>
        <Tooltip content="Automatically arrange nodes with Dagre layered layout" relationship="label">
          <Button size="small" icon={<ArrowAutofitContent24Regular />} onClick={applyAutoLayout}>
            Auto Layout
          </Button>
        </Tooltip>
        <Tooltip content={`Clear ${evidenceCount} evidence selection(s)`} relationship="label">
          <Button size="small" icon={<BroomRegular />} onClick={clearEvidence} disabled={evidenceCount === 0}>
            Clear Evidence
          </Button>
        </Tooltip>
        <Tooltip
          content={
            mapAssignment
              ? `Most likely scenario: ${(mapProbability! * 100).toFixed(1)}% joint probability — click to clear`
              : "Find the single most probable full scenario consistent with current evidence/interventions (MAP query)"
          }
          relationship="label"
        >
          <Button
            size="small"
            appearance={mapAssignment ? "primary" : "outline"}
            icon={isMapQuerying ? <Spinner size="extra-tiny" /> : <StarRegular />}
            onClick={mapAssignment ? clearMapResult : runMapQuery}
            disabled={isMapQuerying}
          >
            {mapAssignment ? `Most Likely (${(mapProbability! * 100).toFixed(1)}%)` : "Find Most Likely Scenario"}
          </Button>
        </Tooltip>
        <Tooltip content="Reset the canvas to the default demo network" relationship="label">
          <Button size="small" icon={<Delete24Regular />} onClick={resetCanvas}>
            Reset Canvas
          </Button>
        </Tooltip>
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.group}>
        <Tooltip content="Fit every mapped node's CPT from an uploaded CSV (MLE or Bayesian)" relationship="label">
          <Button size="small" icon={<ArrowUploadRegular />} onClick={() => setLearnParamsOpen(true)}>
            Fit from CSV
          </Button>
        </Tooltip>
        <Tooltip content="Discover a DAG structure from data (Hill Climb / PC / Tree Search)" relationship="label">
          <Button size="small" icon={<FlowchartRegular />} onClick={() => setStructureLearnOpen(true)}>
            Auto-Discover DAG
          </Button>
        </Tooltip>
        <Tooltip content="d-separation / Markov blanket explainer" relationship="label">
          <Button size="small" icon={<BranchForkHintRegular />} onClick={() => setExplainOpen(true)}>
            Explain
          </Button>
        </Tooltip>
        <Tooltip content="Generate a synthetic CSV by sampling the current network" relationship="label">
          <Button size="small" icon={<TableSimpleRegular />} onClick={() => setSimulateOpen(true)}>
            Synthetic Data
          </Button>
        </Tooltip>
      </div>

      <Divider vertical style={{ height: "20px" }} />

      <div className={styles.diagnostics}>
        {isInferring && <Spinner size="tiny" label="Inferring…" labelPosition="after" />}
        {!isInferring && methodShort && (
          <Tooltip content={`Solved with ${methodUsed}`} relationship="label">
            <Badge appearance="tint" color={inferError ? "danger" : "success"} size="medium">
              {methodShort} | {latencyMs?.toFixed(2)} ms
            </Badge>
          </Tooltip>
        )}
        {inferError && (
          <Tooltip content={inferError} relationship="label">
            <Badge appearance="tint" color="danger" size="medium">
              error
            </Badge>
          </Tooltip>
        )}
      </div>

      <ParameterLearningDialog open={learnParamsOpen} onOpenChange={setLearnParamsOpen} />
      <StructureLearningDialog open={structureLearnOpen} onOpenChange={setStructureLearnOpen} />
      <IndependenceExplainerDialog open={explainOpen} onOpenChange={setExplainOpen} />
      <SimulateDialog open={simulateOpen} onOpenChange={setSimulateOpen} />
    </div>
  );
}
