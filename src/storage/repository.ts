import type {
  Actor,
  DeleteResult,
  EdgeDirection,
  EdgeTypeDefinition,
  FullGraphExport,
  GraphChange,
  GraphContext,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  Metadata,
  MetadataSchema,
  MutationResult,
  NodeTypeDefinition,
  SearchResult,
  WriteOptions,
} from "../domain/types";

export interface TypeInput {
  id?: string;
  name: string;
  description?: string;
  metadataSchema?: MetadataSchema;
}

export interface NodeInput {
  id?: string;
  name: string;
  typeId: string;
  description?: string;
  metadata?: Metadata;
}

export interface EdgeInput {
  id?: string;
  typeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction: EdgeDirection;
  description?: string;
  metadata?: Metadata;
}

export interface GraphRepository {
  getSnapshot(options?: { includeDeleted?: boolean }): GraphSnapshot;
  getHistory(): GraphChange[];
  getHistoryVersion(version: number): GraphChange | null;
  search(query: string): SearchResult;
  getContext(nodeId: string): GraphContext;
  createNodeType(input: TypeInput, options: WriteOptions): MutationResult<NodeTypeDefinition>;
  updateNodeType(id: string, input: Partial<TypeInput>, options: WriteOptions): MutationResult<NodeTypeDefinition>;
  deleteNodeType(id: string, options: WriteOptions): DeleteResult;
  createEdgeType(input: TypeInput, options: WriteOptions): MutationResult<EdgeTypeDefinition>;
  updateEdgeType(id: string, input: Partial<TypeInput>, options: WriteOptions): MutationResult<EdgeTypeDefinition>;
  deleteEdgeType(id: string, options: WriteOptions): DeleteResult;
  createNode(input: NodeInput, options: WriteOptions): MutationResult<GraphNode>;
  updateNode(id: string, input: Partial<NodeInput>, options: WriteOptions): MutationResult<GraphNode>;
  deleteNode(id: string, options: WriteOptions): DeleteResult;
  createEdge(input: EdgeInput, options: WriteOptions): MutationResult<GraphEdge>;
  updateEdge(id: string, input: Partial<EdgeInput>, options: WriteOptions): MutationResult<GraphEdge>;
  deleteEdge(id: string, options: WriteOptions): DeleteResult;
  seedBootstrap(actor: Actor): GraphSnapshot;
  exportGraph(): FullGraphExport;
  importGraph(payload: FullGraphExport, actor: Actor): GraphSnapshot;
  close(): void;
}

