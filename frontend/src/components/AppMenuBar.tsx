import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowRedoRegular, ArrowUndoRegular, CheckmarkRegular } from "@fluentui/react-icons";
import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";

import { ApiError, exportNetworkFile, importNetworkFile } from "../lib/api";
import { exportNetworkAsPdf, exportNetworkAsPng, exportNetworkAsSvg } from "../lib/exportImage";
import { saveTextFile } from "../lib/saveFile";
import { redo, undo, useNetworkStore, useTemporalStore } from "../store/useNetworkStore";
import {
  FILE_FORMAT_EXTENSIONS,
  FILE_FORMAT_LABELS,
  type NetworkFileFormat,
  type NetworkPayload,
} from "../lib/types";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "2px 8px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  menuButton: {
    minWidth: 0,
    padding: "2px 10px",
    fontSize: "13px",
  },
  aboutBody: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
});

const SAVE_FORMATS: NetworkFileFormat[] = ["json", "bif", "net", "xdsl", "dsc"];
const OPEN_ACCEPT = SAVE_FORMATS.map((f) => `.${FILE_FORMAT_EXTENSIONS[f]}`).join(",");

function extensionOf(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

export function AppMenuBar() {
  const styles = useStyles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { fitView } = useReactFlow();

  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edges = useNetworkStore((s) => s.edges);
  const evidence = useNetworkStore((s) => s.evidence);
  const options = useNetworkStore((s) => s.options);
  const selectedNodeId = useNetworkStore((s) => s.selectedNodeId);
  const showMinimap = useNetworkStore((s) => s.showMinimap);
  const showNodePanel = useNetworkStore((s) => s.showNodePanel);
  const canUndo = useTemporalStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalStore((s) => s.futureStates.length > 0);

  const addNode = useNetworkStore((s) => s.addNode);
  const removeNode = useNetworkStore((s) => s.removeNode);
  const clearEvidence = useNetworkStore((s) => s.clearEvidence);
  const resetCanvas = useNetworkStore((s) => s.resetCanvas);
  const applyAutoLayout = useNetworkStore((s) => s.applyAutoLayout);
  const toggleMinimap = useNetworkStore((s) => s.toggleMinimap);
  const toggleNodePanel = useNetworkStore((s) => s.toggleNodePanel);
  const loadNetwork = useNetworkStore((s) => s.loadNetwork);
  const projectName = useNetworkStore((s) => s.projectName);
  const setProjectName = useNetworkStore((s) => s.setProjectName);
  const theme = useNetworkStore((s) => s.theme);
  const setTheme = useNetworkStore((s) => s.setTheme);
  const autoInfer = useNetworkStore((s) => s.autoInfer);
  const setAutoInfer = useNetworkStore((s) => s.setAutoInfer);
  const inferNow = useNetworkStore((s) => s.inferNow);
  const marginals = useNetworkStore((s) => s.marginals);
  const interventions = useNetworkStore((s) => s.interventions);
  const mapAssignment = useNetworkStore((s) => s.mapAssignment);
  const timeSlices = useNetworkStore((s) => s.timeSlices);
  const virtualEvidence = useNetworkStore((s) => s.virtualEvidence);

  const handleSaveAs = async (format: NetworkFileFormat) => {
    const virtualEvidenceList = Object.entries(virtualEvidence).flatMap(([nodeId, bySlice]) =>
      Object.entries(bySlice).map(([slice, distribution]) => ({
        node_id: nodeId,
        time_slice: Number(slice),
        distribution,
      })),
    );
    const payload: NetworkPayload = {
      nodes: Object.values(nodeDefs),
      edges,
      evidence,
      options,
      dbn_time_slices: timeSlices,
      virtual_evidence: virtualEvidenceList,
    };
    const filename = `${projectName}.${FILE_FORMAT_EXTENSIONS[format]}`;
    try {
      if (format === "json") {
        await saveTextFile(JSON.stringify(payload, null, 2), filename, "application/json");
        return;
      }
      const content = await exportNetworkFile(payload, format);
      await saveTextFile(content, filename, "text/plain");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      // eslint-disable-next-line no-alert
      alert(`Could not save as ${FILE_FORMAT_LABELS[format]}: ${message}`);
    }
  };

  const handleExportImage = async (format: "png" | "svg" | "pdf") => {
    const opts = { nodeDefs, edges, marginals, evidence, interventions, mapAssignment };
    const filename = `${projectName}.${format}`;
    try {
      if (format === "svg") await exportNetworkAsSvg(opts, filename);
      else if (format === "pdf") await exportNetworkAsPdf(opts, filename);
      else await exportNetworkAsPng(opts, filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-alert
      alert(`Could not export as ${format.toUpperCase()}: ${message}`);
    }
  };

  const handleOpenFile = async (file: File) => {
    const ext = extensionOf(file.name);
    const format = SAVE_FORMATS.find((f) => FILE_FORMAT_EXTENSIONS[f] === ext);
    if (!format) {
      // eslint-disable-next-line no-alert
      alert(`Unrecognized file extension ".${ext}". Expected one of: ${SAVE_FORMATS.map((f) => `.${FILE_FORMAT_EXTENSIONS[f]}`).join(", ")}`);
      return;
    }
    try {
      const text = await file.text();
      const payload =
        format === "json" ? (JSON.parse(text) as NetworkPayload) : await importNetworkFile(text, format);
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new Error("File is missing nodes[] or edges[]");
      }
      loadNetwork(payload);
      setProjectName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-alert
      alert(`Could not open network: ${message}`);
    }
  };

  return (
    <div className={styles.bar}>
      <input
        ref={fileInputRef}
        type="file"
        accept={OPEN_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleOpenFile(file);
          e.target.value = "";
        }}
      />

      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={styles.menuButton}>
            File
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={resetCanvas}>New Network</MenuItem>
            <MenuItem onClick={() => fileInputRef.current?.click()}>
              Open… (JSON / BIF / NET / XDSL / DSC)
            </MenuItem>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem>Save As</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {SAVE_FORMATS.map((format) => (
                    <MenuItem key={format} onClick={() => void handleSaveAs(format)}>
                      {FILE_FORMAT_LABELS[format]}
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem>Export Image</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => void handleExportImage("png")}>PNG (raster)</MenuItem>
                  <MenuItem onClick={() => void handleExportImage("svg")}>SVG (vector)</MenuItem>
                  <MenuItem onClick={() => void handleExportImage("pdf")}>PDF (vector)</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <MenuDivider />
            <MenuItem onClick={() => window.close()}>Exit</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={styles.menuButton}>
            Edit
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<ArrowUndoRegular />} secondaryContent="Ctrl+Z" disabled={!canUndo} onClick={undo}>
              Undo
            </MenuItem>
            <MenuItem
              icon={<ArrowRedoRegular />}
              secondaryContent="Ctrl+Shift+Z"
              disabled={!canRedo}
              onClick={redo}
            >
              Redo
            </MenuItem>
            <MenuDivider />
            <MenuItem onClick={addNode}>Add Node</MenuItem>
            <MenuItem
              disabled={!selectedNodeId}
              onClick={() => selectedNodeId && removeNode(selectedNodeId)}
            >
              Delete Selected Node
            </MenuItem>
            <MenuDivider />
            <MenuItem onClick={clearEvidence}>Clear Evidence</MenuItem>
            <MenuItem onClick={resetCanvas}>Reset Canvas</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={styles.menuButton}>
            View
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={applyAutoLayout}>Auto Layout</MenuItem>
            <MenuItem onClick={() => fitView({ duration: 300 })}>Fit to Window</MenuItem>
            <MenuDivider />
            <MenuItem
              icon={showNodePanel ? <CheckmarkRegular /> : undefined}
              onClick={toggleNodePanel}
            >
              Show Node Panel
            </MenuItem>
            <MenuItem
              icon={showMinimap ? <CheckmarkRegular /> : undefined}
              onClick={toggleMinimap}
            >
              Show Minimap
            </MenuItem>
            <MenuDivider />
            <MenuItem
              icon={theme === "light" ? <CheckmarkRegular /> : undefined}
              onClick={() => setTheme("light")}
            >
              Light Theme
            </MenuItem>
            <MenuItem
              icon={theme === "dark" ? <CheckmarkRegular /> : undefined}
              onClick={() => setTheme("dark")}
            >
              Dark Theme
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={styles.menuButton}>
            Options
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem
              icon={autoInfer ? <CheckmarkRegular /> : undefined}
              onClick={() => setAutoInfer(!autoInfer)}
            >
              Auto Infer
            </MenuItem>
            <MenuItem onClick={inferNow}>Infer Now</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={styles.menuButton}>
            Help
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => setAboutOpen(true)}>About LibRE Bayes</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Dialog open={aboutOpen} onOpenChange={(_, data) => setAboutOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>LibRE Bayes</DialogTitle>
            <DialogContent className={styles.aboutBody}>
              <Text>
                A modular Bayesian network editor with pluggable exact and approximate
                inference solvers.
              </Text>
              <Text size={200}>
                React · Fluent UI v9 · React Flow · Zustand — backed by FastAPI + pgmpy.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setAboutOpen(false)}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
