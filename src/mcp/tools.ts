import { GraphError } from "../domain/errors";
import {
  parseEdgeInput,
  parseNodeInput,
  parseTypeInput,
  requiredId,
  type JsonMap,
} from "../graph/input";
import type { RealtimeHub } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";

export type { JsonMap };

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
  | "delete_edge_type";

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
];

export interface LinkToolContext {
  repository: GraphRepository;
  realtime: RealtimeHub;
}

function broadcast(hub: RealtimeHub, recordType: string, recordId: string, operation: string): void {
  hub.broadcast({ type: "graph.changed", recordType, recordId, operation });
}

export function callLinkTool(name: string, args: JsonMap, context: LinkToolContext): unknown {
  const { repository, realtime } = context;
  const mutate = <T extends { record?: { id?: string }; deletedId?: string }>(
    recordType: string,
    operation: string,
    action: () => T,
  ): T => {
    const result = action();
    broadcast(realtime, recordType, result.record?.id ?? result.deletedId ?? recordType, operation);
    return result;
  };

  switch (name) {
    case "get_graph":
      return repository.getSnapshot();
    case "search_graph":
      if (String(args.query ?? "").trim() === "") {
        const snapshot = repository.getSnapshot();
        return { nodes: snapshot.nodes, nodeTypes: snapshot.nodeTypes, edgeTypes: snapshot.edgeTypes, edges: snapshot.edges };
      }
      return repository.search(String(args.query ?? ""));
    case "get_node_context":
      return repository.getContext(String(args.nodeId ?? ""));
    case "create_node_type":
      return mutate("nodeType", "create", () => repository.createNodeType(parseTypeInput(args) as TypeInput));
    case "update_node_type":
      return mutate("nodeType", "update", () => repository.updateNodeType(requiredId(args), parseTypeInput(args, true)));
    case "delete_node_type":
      return mutate("nodeType", "delete", () => repository.deleteNodeType(requiredId(args)));
    case "create_edge_type":
      return mutate("edgeType", "create", () => repository.createEdgeType(parseTypeInput(args) as TypeInput));
    case "update_edge_type":
      return mutate("edgeType", "update", () => repository.updateEdgeType(requiredId(args), parseTypeInput(args, true)));
    case "delete_edge_type":
      return mutate("edgeType", "delete", () => repository.deleteEdgeType(requiredId(args)));
    case "create_node":
      return mutate("node", "create", () => repository.createNode(parseNodeInput(args) as NodeInput));
    case "update_node":
      return mutate("node", "update", () => repository.updateNode(requiredId(args), parseNodeInput(args, true)));
    case "delete_node":
      return mutate("node", "delete", () => repository.deleteNode(requiredId(args)));
    case "create_edge":
      return mutate("edge", "create", () => repository.createEdge(parseEdgeInput(args) as EdgeInput));
    case "update_edge":
      return mutate("edge", "update", () => repository.updateEdge(requiredId(args), parseEdgeInput(args, true)));
    case "delete_edge":
      return mutate("edge", "delete", () => repository.deleteEdge(requiredId(args)));
    default:
      throw new GraphError("VALIDATION", "Unknown MCP tool.", { name });
  }
}
