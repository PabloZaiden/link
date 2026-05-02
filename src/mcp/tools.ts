import { GraphError } from "../domain/errors";
import type { Actor, EdgeDirection, Metadata, MetadataSchema } from "../domain/types";
import type { RealtimeHub } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";

export interface JsonMap {
  [key: string]: unknown;
}

export type LinkMcpToolName =
  | "get_graph"
  | "search_graph"
  | "get_node_context"
  | "create_node"
  | "update_node"
  | "delete_node"
  | "create_edge"
  | "update_edge"
  | "delete_edge"
  | "create_node_type"
  | "update_node_type"
  | "delete_node_type"
  | "create_edge_type"
  | "update_edge_type"
  | "delete_edge_type"
  | "get_history"
  | "export_graph";

export const linkMcpToolNames: LinkMcpToolName[] = [
  "get_graph",
  "search_graph",
  "get_node_context",
  "create_node",
  "update_node",
  "delete_node",
  "create_edge",
  "update_edge",
  "delete_edge",
  "create_node_type",
  "update_node_type",
  "delete_node_type",
  "create_edge_type",
  "update_edge_type",
  "delete_edge_type",
  "get_history",
  "export_graph",
];

export interface LinkToolContext {
  repository: GraphRepository;
  realtime: RealtimeHub;
  actor: Actor;
}

export function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(args: JsonMap, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new GraphError("VALIDATION", `${field} must be a string.`, { field, value });
  return value;
}

function requiredString(args: JsonMap, field: string): string {
  const value = optionalString(args, field);
  if (value === undefined) throw new GraphError("VALIDATION", `${field} is required.`, { field });
  return value;
}

function optionalObject<T extends JsonMap>(args: JsonMap, field: string): T | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (!isJsonMap(value)) throw new GraphError("VALIDATION", `${field} must be an object.`, { field, value });
  return value as T;
}

function requiredDirection(args: JsonMap): EdgeDirection {
  const direction = requiredString(args, "direction");
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

function optionalDirection(args: JsonMap): EdgeDirection | undefined {
  const direction = optionalString(args, "direction");
  if (direction === undefined) return undefined;
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

function parseTypeInput(args: JsonMap, partial = false): Partial<TypeInput> | TypeInput {
  return {
    id: optionalString(args, "id"),
    name: partial ? optionalString(args, "name") : requiredString(args, "name"),
    description: optionalString(args, "description"),
    metadataSchema: optionalObject<MetadataSchema>(args, "metadataSchema"),
  };
}

function parseNodeInput(args: JsonMap, partial = false): Partial<NodeInput> | NodeInput {
  return {
    id: optionalString(args, "id"),
    name: partial ? optionalString(args, "name") : requiredString(args, "name"),
    typeId: partial ? optionalString(args, "typeId") : requiredString(args, "typeId"),
    description: optionalString(args, "description"),
    metadata: optionalObject<Metadata>(args, "metadata"),
  };
}

function parseEdgeInput(args: JsonMap, partial = false): Partial<EdgeInput> | EdgeInput {
  return {
    id: optionalString(args, "id"),
    typeId: partial ? optionalString(args, "typeId") : requiredString(args, "typeId"),
    sourceNodeId: partial ? optionalString(args, "sourceNodeId") : requiredString(args, "sourceNodeId"),
    targetNodeId: partial ? optionalString(args, "targetNodeId") : requiredString(args, "targetNodeId"),
    direction: partial ? optionalDirection(args) : requiredDirection(args),
    description: optionalString(args, "description"),
    metadata: optionalObject<Metadata>(args, "metadata"),
  };
}

function requiredId(args: JsonMap, field = "id"): string {
  return requiredString(args, field);
}

function expectedVersionFromValue(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    throw new GraphError("VALIDATION", "Mutations require a non-negative integer expectedVersion.", { expectedVersion: value });
  }
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new GraphError("VALIDATION", "Mutations require a non-negative integer expectedVersion.", { expectedVersion: value });
  }
  return version;
}

function broadcast(hub: RealtimeHub, version: number, recordType: string, recordId: string, operation: string): void {
  hub.broadcast({ type: "graph.changed", version, recordType, recordId, operation });
}

export function callLinkTool(name: string, args: JsonMap, context: LinkToolContext): unknown {
  const { repository, realtime, actor } = context;
  const mutate = <T extends { version: number; record?: { id?: string }; deletedId?: string }>(
    recordType: string,
    operation: string,
    action: () => T,
  ): T => {
    const result = action();
    broadcast(realtime, result.version, recordType, result.record?.id ?? result.deletedId ?? recordType, operation);
    return result;
  };

  switch (name) {
    case "get_graph":
      return repository.getSnapshot();
    case "search_graph":
      return repository.search(String(args.query ?? ""));
    case "get_node_context":
      return repository.getContext(String(args.nodeId ?? ""));
    case "get_history":
      return repository.getHistory();
    case "export_graph":
      return repository.exportGraph();
    case "create_node_type":
      return mutate("nodeType", "create", () =>
        repository.createNodeType(parseTypeInput(args) as TypeInput, { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "update_node_type":
      return mutate("nodeType", "update", () =>
        repository.updateNodeType(requiredId(args), parseTypeInput(args, true), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "delete_node_type":
      return mutate("nodeType", "delete", () =>
        repository.deleteNodeType(requiredId(args), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "create_edge_type":
      return mutate("edgeType", "create", () =>
        repository.createEdgeType(parseTypeInput(args) as TypeInput, { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "update_edge_type":
      return mutate("edgeType", "update", () =>
        repository.updateEdgeType(requiredId(args), parseTypeInput(args, true), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "delete_edge_type":
      return mutate("edgeType", "delete", () =>
        repository.deleteEdgeType(requiredId(args), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "create_node":
      return mutate("node", "create", () =>
        repository.createNode(parseNodeInput(args) as NodeInput, { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "update_node":
      return mutate("node", "update", () =>
        repository.updateNode(requiredId(args), parseNodeInput(args, true), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "delete_node":
      return mutate("node", "delete", () => repository.deleteNode(requiredId(args), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }));
    case "create_edge":
      return mutate("edge", "create", () =>
        repository.createEdge(parseEdgeInput(args) as EdgeInput, { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "update_edge":
      return mutate("edge", "update", () =>
        repository.updateEdge(requiredId(args), parseEdgeInput(args, true), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }),
      );
    case "delete_edge":
      return mutate("edge", "delete", () => repository.deleteEdge(requiredId(args), { expectedVersion: expectedVersionFromValue(args.expectedVersion), actor }));
    default:
      throw new GraphError("VALIDATION", "Unknown MCP tool.", { name });
  }
}

