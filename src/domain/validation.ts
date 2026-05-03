import { conflictError, notFoundError, validationError } from "./errors";
import { validateMetadata } from "./metadata";
import type {
  EdgeDirection,
  EdgeTypeDefinition,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  Metadata,
  NodeTypeDefinition,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function assertName(name: string): void {
  if (!name.trim()) throw validationError("Name is required.");
}

export function assertDirection(direction: EdgeDirection): void {
  if (direction !== "directed" && direction !== "bidirectional") {
    throw validationError("Edge direction must be directed or bidirectional.", { direction });
  }
}

export function findActiveNodeType(snapshot: GraphSnapshot, id: string): NodeTypeDefinition {
  const record = snapshot.nodeTypes.find(type => type.id === id);
  if (!record) throw notFoundError("Node type not found.", { id });
  return record;
}

export function findActiveEdgeType(snapshot: GraphSnapshot, id: string): EdgeTypeDefinition {
  const record = snapshot.edgeTypes.find(type => type.id === id);
  if (!record) throw notFoundError("Edge type not found.", { id });
  return record;
}

export function findActiveNode(snapshot: GraphSnapshot, id: string): GraphNode {
  const record = snapshot.nodes.find(node => node.id === id);
  if (!record) throw notFoundError("Node not found.", { id });
  return record;
}

export function findActiveEdge(snapshot: GraphSnapshot, id: string): GraphEdge {
  const record = snapshot.edges.find(edge => edge.id === id);
  if (!record) throw notFoundError("Edge not found.", { id });
  return record;
}

export function assertNodeTypeUnused(snapshot: GraphSnapshot, typeId: string): void {
  const activeNode = snapshot.nodes.find(node => node.typeId === typeId);
  if (activeNode) {
    throw conflictError("Cannot delete a node type that is used by active nodes.", { typeId, nodeId: activeNode.id });
  }
}

export function assertEdgeTypeUnused(snapshot: GraphSnapshot, typeId: string): void {
  const activeEdge = snapshot.edges.find(edge => edge.typeId === typeId);
  if (activeEdge) {
    throw conflictError("Cannot delete an edge type that is used by active edges.", { typeId, edgeId: activeEdge.id });
  }
}

export function validateNodeMetadata(snapshot: GraphSnapshot, typeId: string, metadata: Metadata): Metadata {
  const type = findActiveNodeType(snapshot, typeId);
  return validateMetadata(type.metadataSchema, metadata);
}

export function validateEdgeMetadata(snapshot: GraphSnapshot, typeId: string, metadata: Metadata): Metadata {
  const type = findActiveEdgeType(snapshot, typeId);
  return validateMetadata(type.metadataSchema, metadata);
}
