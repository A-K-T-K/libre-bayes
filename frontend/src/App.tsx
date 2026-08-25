import { FluentProvider, makeStyles, tokens, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlignmentToolbar } from "./components/AlignmentToolbar";
import { AppMenuBar } from "./components/AppMenuBar";
import { BayesianNode, type BayesianNodeData } from "./components/BayesianNode";
import { CanvasContextMenu } from "./components/CanvasContextMenu";
import { CommandRibbon } from "./components/CommandRibbon";
import { CPTEditor } from "./components/CPTEditor";
import { EdgeContextMenu } from "./components/EdgeContextMenu";
import { FloatingConnectionLine } from "./components/FloatingConnectionLine";
import { FloatingEdge } from "./components/FloatingEdge";
import { GhostNodePreview } from "./components/GhostNodePreview";
import { NodeListPanel } from "./components/NodeListPanel";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { useUndoRedoShortcuts } from "./hooks/useUndoRedoShortcuts";
import { getEffectiveSize } from "./lib/nodeGeometry";
import { useNetworkStore, triggerInitialInference } from "./store/useNetworkStore";
import type { NodeSize, Position } from "./lib/types";

const nodeTypes: NodeTypes = {
  bayesian: BayesianNode,
  ghost: GhostNodePreview,
};

const edgeTypes: EdgeTypes = {
  floating: FloatingEdge,
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  canvasArea: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
  },
  flowWrapper: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
});

const MIN_DRAWN_SIZE = 56;
const DEFAULT_NODE_SIZE = 92;
const CLICK_VS_DRAG_THRESHOLD = 6;

function toFlowNode(
  id: string,
  def: {
    name?: string;
    states: string[];
    parents: string[];
    position?: Position;
    size?: NodeSize;
    displayMode?: BayesianNodeData["displayMode"];
    temporal?: boolean;
  },
  selectedNodeIds: string[],
): Node<BayesianNodeData> {
  // NodeResizer owns resizing the node's outer box directly (via React
  // Flow's own node.width/height), so that box always needs an explicit
  // starting size -- defaulted per display mode (and, for bar mode, per
  // state count) when the node has never been resized/drawn with an
  // explicit one.
  const size = getEffectiveSize(def);
  return {
    id,
    type: "bayesian",
    position: def.position ?? { x: 0, y: 0 },
    width: size.width,
    height: size.height,
    // Selection is driven entirely by `selectedNodeIds` (the same set the
    // node-list panel, CPT inspector, and alignment toolbar use), so
    // selecting a node anywhere -- canvas, panel, or via keyboard -- stays
    // in sync everywhere.
    selected: selectedNodeIds.includes(id),
    data: {
      label: id,
      name: def.name,
      states: def.states,
      parents: def.parents,
      size: def.size,
      displayMode: def.displayMode,
      temporal: def.temporal,
      multiSelectActive: selectedNodeIds.length > 1,
    },
  };
}

function Canvas() {
  const nodeDefs = useNetworkStore((s) => s.nodeDefs);
  const edgeDefs = useNetworkStore((s) => s.edges);
  const addEdge = useNetworkStore((s) => s.addEdge);
  const removeEdge = useNetworkStore((s) => s.removeEdge);
  const updateNodePosition = useNetworkStore((s) => s.updateNodePosition);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const setSelectionIds = useNetworkStore((s) => s.setSelectionIds);
  const clearSelection = useNetworkStore((s) => s.clearSelection);
  const showMinimap = useNetworkStore((s) => s.showMinimap);
  const theme = useNetworkStore((s) => s.theme);
  const tool = useNetworkStore((s) => s.tool);
  const setTool = useNetworkStore((s) => s.setTool);
  const addNodeAt = useNetworkStore((s) => s.addNodeAt);

  const { screenToFlowPosition } = useReactFlow();
  const viewport = useViewport();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BayesianNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [drawRect, setDrawRect] = useState<{
    start: Position;
    current: Position;
    startClient: Position;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    start: Position;
    current: Position;
    additive: boolean;
  } | null>(null);

  const nodeSignature = useMemo(
    () =>
      Object.values(nodeDefs)
        .map(
          (n) =>
            `${n.id}:${n.name}:${n.states.join(",")}:${n.parents.join(",")}:${n.position?.x},${n.position?.y}:${n.size?.width},${n.size?.height}:${n.displayMode}`,
        )
        .join("|") + `|selected:${selectedNodeIds.join(",")}`,
    [nodeDefs, selectedNodeIds],
  );

  useEffect(() => {
    setNodes(Object.entries(nodeDefs).map(([id, def]) => toFlowNode(id, def, selectedNodeIds)));
  }, [nodeSignature, nodeDefs, selectedNodeIds, setNodes]);

  useEffect(() => {
    setEdges(
      edgeDefs.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
        type: "floating",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: tokens.colorNeutralStrokeAccessible,
        },
      })),
    );
  }, [edgeDefs, setEdges]);

  const [edgeMenu, setEdgeMenu] = useState<{ id: string; source: string; target: string; x: number; y: number } | null>(
    null,
  );
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const suppressNextPaneClick = useRef(false);

  const onEdgeContextMenu: EdgeMouseHandler = (event, edge) => {
    event.preventDefault();
    setEdgeMenu({ id: edge.id, source: edge.source, target: edge.target, x: event.clientX, y: event.clientY });
  };

  const onConnect: OnConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // Only mutate the store here -- the edgeDefs-driven effect above is the
    // single source of truth for `edges`, so a rejected (e.g. duplicate)
    // connection never desyncs from what's actually rendered.
    addEdge(connection.source, connection.target);
  };

  const onEdgesDelete = (deleted: Edge[]) => {
    deleted.forEach((edge) => removeEdge(edge.source, edge.target));
  };

  const onNodeDragStop: OnNodeDrag<Node<BayesianNodeData>> = (_event, node) => {
    updateNodePosition(node.id, node.position);
  };

  // --- "Draw node" tool: click-drag on empty canvas sizes/places a new node,
  // matching a shape tool in a drawing app. A short drag (below threshold)
  // falls back to a single default-size click-to-place, like GeNIe.
  const handlePaneMouseDown = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;

      if (tool === "node") {
        event.preventDefault();
        const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        setDrawRect({ start, current: start, startClient: { x: event.clientX, y: event.clientY } });
        return;
      }

      // Left-drag on empty canvas in the select tool starts a marquee/
      // rubber-band selection box (matching GeNIe/Visio-style editors);
      // canvas panning moves to the middle mouse button and scroll/pinch
      // instead (see `panOnDrag`/`panOnScroll` on <ReactFlow> below), and a
      // Shift-held drag adds the box's contents to the existing selection
      // rather than replacing it.
      if (tool === "select" && event.button === 0) {
        const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        setMarquee({ start, current: start, additive: event.shiftKey });
      }
    },
    [tool, screenToFlowPosition],
  );

  useEffect(() => {
    if (!drawRect) return;

    const onMove = (event: MouseEvent) => {
      const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setDrawRect((r) => (r ? { ...r, current } : r));
    };

    const onUp = (event: MouseEvent) => {
      const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const dragW = Math.abs(current.x - drawRect.start.x);
      const dragH = Math.abs(current.y - drawRect.start.y);
      const screenDist = Math.hypot(
        event.clientX - drawRect.startClient.x,
        event.clientY - drawRect.startClient.y,
      );
      const wasClick = screenDist < CLICK_VS_DRAG_THRESHOLD;

      if (wasClick) {
        addNodeAt({
          x: drawRect.start.x - DEFAULT_NODE_SIZE / 2,
          y: drawRect.start.y - DEFAULT_NODE_SIZE / 2,
        });
      } else {
        const width = Math.max(MIN_DRAWN_SIZE, dragW);
        const height = Math.max(MIN_DRAWN_SIZE, dragH);
        addNodeAt(
          {
            x: Math.min(drawRect.start.x, current.x),
            y: Math.min(drawRect.start.y, current.y),
          },
          { width, height },
        );
      }
      setDrawRect(null);
      setTool("select");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drawRect, screenToFlowPosition, addNodeAt, setTool]);

  useEffect(() => {
    if (!marquee) return;

    const onMove = (event: MouseEvent) => {
      const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setMarquee((m) => (m ? { ...m, current } : m));
    };

    const onUp = (event: MouseEvent) => {
      const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const bx0 = Math.min(marquee.start.x, current.x);
      const by0 = Math.min(marquee.start.y, current.y);
      const bx1 = Math.max(marquee.start.x, current.x);
      const by1 = Math.max(marquee.start.y, current.y);

      const hit: string[] = [];
      for (const [id, def] of Object.entries(nodeDefs)) {
        const pos = def.position ?? { x: 0, y: 0 };
        const size = getEffectiveSize(def);
        const nx0 = pos.x;
        const ny0 = pos.y;
        const nx1 = pos.x + size.width;
        const ny1 = pos.y + size.height;
        const intersects = nx0 < bx1 && nx1 > bx0 && ny0 < by1 && ny1 > by0;
        if (intersects) hit.push(id);
      }

      setSelectionIds(hit, { additive: marquee.additive });
      setMarquee(null);
      // A browser fires a synthetic "click" on the pane right after this
      // mouseup (mousedown and mouseup shared the same target element,
      // regardless of how far the pointer moved between them), which would
      // otherwise immediately hit onPaneClick and wipe the selection this
      // drag just made.
      suppressNextPaneClick.current = true;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [marquee, screenToFlowPosition, nodeDefs, setSelectionIds]);

  const ghostNode: Node<BayesianNodeData>[] = drawRect
    ? [
        {
          id: "__ghost__",
          type: "ghost",
          position: {
            x: Math.min(drawRect.start.x, drawRect.current.x),
            y: Math.min(drawRect.start.y, drawRect.current.y),
          },
          data: {
            width: Math.max(MIN_DRAWN_SIZE, Math.abs(drawRect.current.x - drawRect.start.x)),
            height: Math.max(MIN_DRAWN_SIZE, Math.abs(drawRect.current.y - drawRect.start.y)),
          } as unknown as BayesianNodeData,
          draggable: false,
          selectable: false,
          connectable: false,
        },
      ]
    : [];

  const marqueeStyle = useMemo(() => {
    if (!marquee) return null;
    const { x: vx, y: vy, zoom } = viewport;
    const fx0 = Math.min(marquee.start.x, marquee.current.x);
    const fy0 = Math.min(marquee.start.y, marquee.current.y);
    const fx1 = Math.max(marquee.start.x, marquee.current.x);
    const fy1 = Math.max(marquee.start.y, marquee.current.y);
    return {
      left: fx0 * zoom + vx,
      top: fy0 * zoom + vy,
      width: (fx1 - fx0) * zoom,
      height: (fy1 - fy0) * zoom,
    };
  }, [marquee, viewport]);

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "100%", cursor: tool === "node" ? "crosshair" : undefined }}
      onMouseDownCapture={handlePaneMouseDown}
    >
      <ReactFlow
        colorMode={theme}
        nodes={[...nodes, ...ghostNode]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => {
          if (suppressNextPaneClick.current) {
            suppressNextPaneClick.current = false;
            return;
          }
          clearSelection();
          setEdgeMenu(null);
          setPaneMenu(null);
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          // Only ever offer the alignment menu -- with fewer than 2 nodes
          // selected there's nothing on it to show.
          if (selectedNodeIds.length < 2) return;
          setPaneMenu({ x: event.clientX, y: event.clientY });
        }}
        onMoveStart={() => {
          setEdgeMenu(null);
          setPaneMenu(null);
        }}
        connectionLineComponent={FloatingConnectionLine}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={tool === "select"}
        panOnDrag={tool === "node" ? false : tool === "select" ? [1] : true}
        panOnScroll
        selectionOnDrag={false}
        deleteKeyCode={null}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        {showMinimap && <MiniMap pannable zoomable />}
      </ReactFlow>
      {marqueeStyle && (
        <div
          style={{
            position: "absolute",
            left: marqueeStyle.left,
            top: marqueeStyle.top,
            width: marqueeStyle.width,
            height: marqueeStyle.height,
            border: "1px solid rgba(0, 120, 212, 0.9)",
            backgroundColor: "rgba(0, 120, 212, 0.12)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
      )}
      <AlignmentToolbar />
      {edgeMenu && (
        <EdgeContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          onDelete={() => {
            removeEdge(edgeMenu.source, edgeMenu.target);
            setEdgeMenu(null);
          }}
          onClose={() => setEdgeMenu(null)}
        />
      )}
      {paneMenu && <CanvasContextMenu x={paneMenu.x} y={paneMenu.y} onClose={() => setPaneMenu(null)} />}
    </div>
  );
}

export default function App() {
  const styles = useStyles();
  const theme = useNetworkStore((s) => s.theme);
  const initialized = useRef(false);
  useUndoRedoShortcuts();

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      triggerInitialInference();
    }
  }, []);

  // Without `color-scheme`, native chrome (scrollbars, form control
  // defaults) stays light-styled regardless of which Fluent theme is
  // active -- and on Windows, the OS's own "force dark mode for apps"
  // heuristic can double itself over an app it doesn't realize already
  // re-themed, washing out text Fluent already painted correctly.
  // `data-theme` drives the hand-styled scrollbars in index.css -- rooted
  // at <html> rather than scoped to this component's own subtree, since
  // Fluent portals Dialogs/Menus/Dropdowns straight to document.body.
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} className={styles.root}>
      <TitleBar />
      <ReactFlowProvider>
        <AppMenuBar />
        <CommandRibbon />
        <div className={styles.canvasArea}>
          <NodeListPanel />
          <div className={styles.flowWrapper}>
            <Canvas />
          </div>
          <CPTEditor />
        </div>
        <StatusBar />
      </ReactFlowProvider>
    </FluentProvider>
  );
}
