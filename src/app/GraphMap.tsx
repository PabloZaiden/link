import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { layoutGraph } from "../graph/layout";
import type { GraphSnapshot } from "./types";

const typeColorPalette = Array.from({ length: 128 }, (_, index) => {
  const hue = (index * 47) % 360;
  const saturation = 52 + ((index * 29) % 18);
  const lightness = 42 + ((index * 31) % 16);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
});

function colorForTypeName(typeName: string): string {
  const normalizedName = typeName.trim().toLowerCase() || "unknown";
  let hash = 2166136261;

  for (const character of normalizedName) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return typeColorPalette[(hash >>> 0) % typeColorPalette.length] ?? "hsl(0 0% 55%)";
}

function graphNodeRadius(connectionCount: number): number {
  return Math.min(84, 8 + Math.pow(connectionCount, 1.18) * 5.2);
}

interface GraphMapProps {
  graph: GraphSnapshot;
  selectedNodeId: string;
  selectedNodeTypeFilterIds: string[];
  selectedEdgeTypeFilterIds: string[];
  onSelectNode: (id: string) => void;
  onClearSelection: () => void;
  controls: ReactNode;
}

export function GraphMap(props: GraphMapProps) {
  const selectedNodeFill = "#f59e0b";
  const selectedNodeStroke = "#fde68a";
  const [scale, setScale] = useState(1);
  const [layoutSpacing, setLayoutSpacing] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; hasDragged: boolean } | null>(null);
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const clearSelectionTimeoutRef = useRef<number | null>(null);
  const nodeTypeNames = new Map(props.graph.nodeTypes.map(nodeType => [nodeType.id, nodeType.name]));
  const edgeTypeNames = new Map(props.graph.edgeTypes.map(edgeType => [edgeType.id, edgeType.name]));
  const nodeConnectionCounts = useMemo(() => {
    const counts = new Map<string, number>(props.graph.nodes.map(node => [node.id, 0]));

    for (const edge of props.graph.edges) {
      counts.set(edge.sourceNodeId, (counts.get(edge.sourceNodeId) ?? 0) + 1);
      counts.set(edge.targetNodeId, (counts.get(edge.targetNodeId) ?? 0) + 1);
    }

    return counts;
  }, [props.graph.edges, props.graph.nodes]);
  const layout = useMemo(
    () =>
      layoutGraph(
        props.graph.nodes.map(node => ({ id: node.id, radius: graphNodeRadius(nodeConnectionCounts.get(node.id) ?? 0) })),
        props.graph.edges.map(edge => ({ sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })),
        { spacingMultiplier: layoutSpacing },
      ),
    [layoutSpacing, nodeConnectionCounts, props.graph.edges, props.graph.nodes],
  );
  const positions = layout.positions;
  const viewBox = `${layout.bounds.minX} ${layout.bounds.minY} ${layout.bounds.width} ${layout.bounds.height}`;
  const showNodeLabels = props.graph.nodes.length <= 90 || scale >= 1.2;
  const showEdgeLabels = props.graph.edges.length <= 60 || scale >= 1.4;
  const directlyConnectedNodeIds = useMemo(() => {
    if (!props.selectedNodeId) {
      return new Set<string>();
    }

    const connectedNodeIds = new Set<string>([props.selectedNodeId]);
    for (const edge of props.graph.edges) {
      if (edge.sourceNodeId === props.selectedNodeId) {
        connectedNodeIds.add(edge.targetNodeId);
      }
      if (edge.targetNodeId === props.selectedNodeId) {
        connectedNodeIds.add(edge.sourceNodeId);
      }
    }

    return connectedNodeIds;
  }, [props.graph.edges, props.selectedNodeId]);

  const focusEdgeIds = useMemo(() => {
    if (!props.selectedNodeId) {
      return new Set<string>();
    }

    return new Set(
      props.graph.edges
        .filter(edge => edge.sourceNodeId === props.selectedNodeId || edge.targetNodeId === props.selectedNodeId)
        .map(edge => edge.id),
    );
  }, [props.graph.edges, props.selectedNodeId]);
  const activeNodeTypeFilterIds = useMemo(() => new Set(props.selectedNodeTypeFilterIds), [props.selectedNodeTypeFilterIds]);
  const activeEdgeTypeFilterIds = useMemo(() => new Set(props.selectedEdgeTypeFilterIds), [props.selectedEdgeTypeFilterIds]);

  const clampScale = (nextScale: number) => Math.min(12, Math.max(0.25, nextScale));

  const getSvgPointFromClient = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) {
      return null;
    }

    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  };

  const setCenteredScale = (nextScale: number, viewportPoint?: { clientX: number; clientY: number }) => {
    const clampedScale = clampScale(nextScale);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    if (clampedScale === currentScale) {
      return;
    }

    const svgPoint = viewportPoint ? getSvgPointFromClient(viewportPoint.clientX, viewportPoint.clientY) : null;
    const graphPointX = svgPoint ? svgPoint.x : layout.bounds.minX + layout.bounds.width / 2;
    const graphPointY = svgPoint ? svgPoint.y : layout.bounds.minY + layout.bounds.height / 2;
    const currentVisibleCenterX = graphPointX / currentScale - currentOffset.x;
    const currentVisibleCenterY = graphPointY / currentScale - currentOffset.y;

    setOffset({
      x: graphPointX / clampedScale - currentVisibleCenterX,
      y: graphPointY / clampedScale - currentVisibleCenterY,
    });
    setScale(clampedScale);
  };

  useEffect(() => {
    scaleRef.current = scale;
    offsetRef.current = offset;
  }, [offset, scale]);

  useEffect(() => {
    return () => {
      if (clearSelectionTimeoutRef.current !== null) {
        window.clearTimeout(clearSelectionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === graphViewportRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const viewport = graphViewportRef.current;
    if (!viewport) {
      return;
    }

    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
        return;
      }

      await viewport.requestFullscreen();
    } catch {
      return;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      dragStateRef.current = null;
      return;
    }

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      hasDragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    const hasDragged =
      dragState.hasDragged || Math.abs(event.clientX - dragState.startX) > 3 || Math.abs(event.clientY - dragState.startY) > 3;
    dragStateRef.current = {
      ...dragState,
      lastX: event.clientX,
      lastY: event.clientY,
      hasDragged,
    };

    if (hasDragged && (deltaX !== 0 || deltaY !== 0)) {
      const svgBounds = event.currentTarget.getBoundingClientRect();
      const graphUnitsPerClientPixelX = layout.bounds.width / svgBounds.width;
      const graphUnitsPerClientPixelY = layout.bounds.height / svgBounds.height;

      setOffset(current => ({
        x: current.x + deltaX * graphUnitsPerClientPixelX,
        y: current.y + deltaY * graphUnitsPerClientPixelY,
      }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!dragState.hasDragged && event.target === event.currentTarget && props.selectedNodeId) {
      if (clearSelectionTimeoutRef.current !== null) {
        window.clearTimeout(clearSelectionTimeoutRef.current);
      }

      clearSelectionTimeoutRef.current = window.setTimeout(() => {
        props.onClearSelection();
        clearSelectionTimeoutRef.current = null;
      }, 180);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (clearSelectionTimeoutRef.current !== null) {
      window.clearTimeout(clearSelectionTimeoutRef.current);
      clearSelectionTimeoutRef.current = null;
    }

    const zoomFactor = event.shiftKey ? 1 / 1.5 : 1.5;
    setCenteredScale(scaleRef.current * zoomFactor, { clientX: event.clientX, clientY: event.clientY });
  };

  const handleResetViewport = () => {
    setScale(1);
    setLayoutSpacing(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div
      ref={graphViewportRef}
      className={isFullscreen ? "graph-map-fullscreen flex h-full flex-col bg-zinc-950 p-4" : "flex h-full min-h-0 flex-col"}
    >
      <div className="graph-map-shell relative flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className={isFullscreen ? "graph-map graph-map--fullscreen block w-full" : "graph-map block w-full"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: dragStateRef.current ? "grabbing" : "grab", touchAction: "none" }}
        >
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {props.graph.edges.map(edge => {
              const source = positions.get(edge.sourceNodeId);
              const target = positions.get(edge.targetNodeId);
              if (!source || !target) return null;
              const label = edgeTypeNames.get(edge.typeId) ?? edge.typeId;
              const edgeColor = colorForTypeName(label);
              const dimmedBySelection = props.selectedNodeId !== "" && !focusEdgeIds.has(edge.id);
              const dimmedByType = activeEdgeTypeFilterIds.size > 0 && !activeEdgeTypeFilterIds.has(edge.typeId);
              const edgeDimmed = dimmedBySelection || dimmedByType;
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2;
              const labelWidth = Math.min(label.length * 7 + 16, 180);
              return (
                <g key={edge.id} opacity={edgeDimmed ? 0.2 : 1}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edgeColor}
                    strokeWidth="14"
                    opacity="0"
                    pointerEvents="none"
                  />
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edgeColor}
                    strokeWidth="2"
                    opacity="0.78"
                    pointerEvents="none"
                  />
                  {showEdgeLabels && (
                    <>
                      <rect
                        x={midX - labelWidth / 2}
                        y={midY - 18}
                        width={labelWidth}
                        height={18}
                        rx="4"
                        fill={edgeColor}
                        opacity="0.2"
                        pointerEvents="none"
                      />
                      <text x={midX} y={midY - 6} textAnchor="middle" fill="#e4e4e7" fontSize="10" pointerEvents="none">
                        {label}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            {props.graph.nodes.map(node => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selected = node.id === props.selectedNodeId;
              const dimmedBySelection = props.selectedNodeId !== "" && !directlyConnectedNodeIds.has(node.id);
              const dimmedByType = activeNodeTypeFilterIds.size > 0 && !activeNodeTypeFilterIds.has(node.typeId);
              const nodeDimmed = dimmedBySelection || dimmedByType;
              const nodeTypeName = nodeTypeNames.get(node.typeId) ?? node.typeId;
              const nodeColor = colorForTypeName(nodeTypeName);
              const label = node.name.slice(0, 18);
              const labelWidth = Math.min(label.length * 7 + 12, 140);
              const connectionCount = nodeConnectionCounts.get(node.id) ?? 0;
              const nodeRadius = graphNodeRadius(connectionCount);
              const visibleRadius = selected ? nodeRadius + 4 : nodeRadius;
              const hitRadius = visibleRadius + 10;
              const labelTop = position.y + visibleRadius + 6;
              return (
                <g key={node.id} className="cursor-pointer" opacity={nodeDimmed ? 0.2 : 1}>
                  <circle cx={position.x} cy={position.y} r={hitRadius} fill="transparent" pointerEvents="all" onClick={() => props.onSelectNode(node.id)} />
                  <circle
                    cx={position.x}
                    cy={position.y}
                    r={visibleRadius}
                    fill={selected ? selectedNodeFill : nodeColor}
                    stroke={selected ? selectedNodeStroke : "rgba(244, 244, 245, 0.2)"}
                    strokeWidth={selected ? 3 : 1.5}
                    onClick={() => props.onSelectNode(node.id)}
                  />
                  {showNodeLabels && (
                    <>
                      <rect
                        x={position.x - labelWidth / 2}
                        y={labelTop}
                        width={labelWidth}
                        height={20}
                        fill="rgba(9, 9, 11, 0.78)"
                        rx="4"
                        pointerEvents="all"
                        onClick={() => props.onSelectNode(node.id)}
                      />
                      <text x={position.x} y={labelTop + 12} textAnchor="middle" fill="#e4e4e7" fontSize="11" pointerEvents="none">
                        {label}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            {props.graph.nodes.length === 0 && (
              <text x="220" y="220" textAnchor="middle" fill="#a1a1aa">
                Seed types and create nodes to see the graph.
              </text>
            )}
          </g>
        </svg>
        <div className="absolute right-3 top-3 z-10 flex max-w-full flex-wrap justify-end gap-2">
          {props.controls}
          <button type="button" className="bg-zinc-950/95 shadow-lg shadow-black/30 backdrop-blur" onClick={handleResetViewport}>
            Reset view
          </button>
          <button
            type="button"
            className="bg-zinc-950/95 shadow-lg shadow-black/30 backdrop-blur"
            onClick={() => {
              void toggleFullscreen();
            }}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
        <div className="absolute bottom-3 right-3 z-10 flex max-w-full flex-wrap justify-end gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300 shadow-lg shadow-black/30 backdrop-blur">
            <span className="whitespace-nowrap">Separation</span>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={layoutSpacing}
              onChange={event => setLayoutSpacing(Number(event.target.value))}
              className="w-24 accent-amber-400"
            />
            <span className="w-8 text-right">{layoutSpacing.toFixed(1)}x</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300 shadow-lg shadow-black/30 backdrop-blur">
            <span className="whitespace-nowrap">Zoom</span>
            <input
              type="range"
              min="0.25"
              max="12"
              step="0.05"
              value={scale}
              onChange={event => setCenteredScale(Number(event.target.value))}
              className="w-24 accent-sky-400"
            />
            <span className="w-10 text-right">{scale.toFixed(2)}x</span>
          </label>
        </div>
      </div>
    </div>
  );
}