export type Metadata = Record<string, unknown>;

export type MetadataEntry = { id: string; key: string; value: string };

export interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  metadataSchema: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  name: string;
  typeId: string;
  description: string;
  metadata: Metadata;
}

export interface GraphEdge {
  id: string;
  typeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction: "directed" | "bidirectional";
  description: string;
  metadata: Metadata;
}

export interface GraphSnapshot {
  version: number;
  nodeTypes: TypeDefinition[];
  edgeTypes: TypeDefinition[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphContext {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type EditorTab = "current" | "new-node" | "new-edge" | "types";

export interface PendingSelection {
  nodeId: string;
  edgeId: string;
}

export interface TypeFilterControlProps {
  label: string;
  allLabel: string;
  options: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export const emptyGraph: GraphSnapshot = { version: 0, nodeTypes: [], edgeTypes: [], nodes: [], edges: [] };