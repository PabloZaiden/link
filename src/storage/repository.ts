import type { DeleteResult, EdgeDirection, EdgeTypeDefinition, GraphContext, GraphEdge, GraphNode, GraphSnapshot, Metadata, MetadataSchema, MutationResult, NodeTypeDefinition, SearchResult } from "../domain/types";

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
  getSnapshot(): GraphSnapshot;
  search(query: string): SearchResult;
  getContext(nodeId: string): GraphContext;
  createNodeType(input: TypeInput): MutationResult<NodeTypeDefinition>;
  updateNodeType(id: string, input: Partial<TypeInput>): MutationResult<NodeTypeDefinition>;
  deleteNodeType(id: string): DeleteResult;
  createEdgeType(input: TypeInput): MutationResult<EdgeTypeDefinition>;
  updateEdgeType(id: string, input: Partial<TypeInput>): MutationResult<EdgeTypeDefinition>;
  deleteEdgeType(id: string): DeleteResult;
  createNode(input: NodeInput): MutationResult<GraphNode>;
  updateNode(id: string, input: Partial<NodeInput>): MutationResult<GraphNode>;
  deleteNode(id: string): DeleteResult;
  createEdge(input: EdgeInput): MutationResult<GraphEdge>;
  updateEdge(id: string, input: Partial<EdgeInput>): MutationResult<GraphEdge>;
  deleteEdge(id: string): DeleteResult;
  close(): void;
}
