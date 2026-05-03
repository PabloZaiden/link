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

export interface GraphRecordBase {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeTypeDefinition extends GraphRecordBase {
  name: string;
  description: string;
  immutable?: boolean;
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

export interface GraphSnapshot {
  nodeTypes: NodeTypeDefinition[];
  edgeTypes: EdgeTypeDefinition[];
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  record: T;
}

export interface DeleteResult {
  deletedId: string;
}
