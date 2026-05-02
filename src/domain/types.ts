export type GraphVersion = number;

export type MetadataPrimitive = string | number | boolean | null;
export type MetadataValue = MetadataPrimitive | MetadataValue[] | { [key: string]: MetadataValue };
export type Metadata = Record<string, MetadataValue>;

export type MetadataFieldType = "string" | "number" | "boolean" | "date" | "enum";

export interface MetadataFieldSchema {
  type: MetadataFieldType;
  label?: string;
  required?: boolean;
  options?: string[];
}

export type MetadataSchema = Record<string, MetadataFieldSchema>;

export interface Actor {
  id: string;
  displayName: string;
}

export interface GraphRecordBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NodeTypeDefinition extends GraphRecordBase {
  name: string;
  description: string;
  metadataSchema: MetadataSchema;
}

export interface EdgeTypeDefinition extends GraphRecordBase {
  name: string;
  description: string;
  metadataSchema: MetadataSchema;
}

export interface GraphNode extends GraphRecordBase {
  name: string;
  typeId: string;
  description: string;
  metadata: Metadata;
}

export type EdgeDirection = "directed" | "bidirectional";

export interface GraphEdge extends GraphRecordBase {
  typeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction: EdgeDirection;
  description: string;
  metadata: Metadata;
}

export type GraphRecordType = "nodeType" | "edgeType" | "node" | "edge" | "graph";
export type GraphOperation = "create" | "update" | "delete" | "seed" | "import";

export interface GraphChange {
  version: GraphVersion;
  actor: Actor;
  timestamp: string;
  operation: GraphOperation;
  recordType: GraphRecordType;
  recordId: string;
  before: unknown;
  after: unknown;
}

export interface GraphSnapshot {
  version: GraphVersion;
  nodeTypes: NodeTypeDefinition[];
  edgeTypes: EdgeTypeDefinition[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FullGraphExport extends GraphSnapshot {
  tombstones: {
    nodeTypes: NodeTypeDefinition[];
    edgeTypes: EdgeTypeDefinition[];
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  history: GraphChange[];
}

export interface GraphContext {
  node: GraphNode;
  edges: GraphEdge[];
  nodes: GraphNode[];
}

export interface SearchResult {
  nodes: GraphNode[];
  nodeTypes: NodeTypeDefinition[];
  edgeTypes: EdgeTypeDefinition[];
  edges: GraphEdge[];
}

export interface MutationResult<T> {
  version: GraphVersion;
  record: T;
}

export interface DeleteResult {
  version: GraphVersion;
  deletedId: string;
}

export interface WriteOptions {
  expectedVersion: GraphVersion;
  actor: Actor;
}

