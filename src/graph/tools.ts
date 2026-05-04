import * as z from "zod/v4";
import { GraphError } from "../domain/errors";
import {
  parseEdgeInput,
  parseNodeInput,
  parseTypeInput,
  requiredId,
  type JsonMap,
} from "../graph/input";
import type { GraphChangeEvent } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";

export type { JsonMap };

export interface GraphToolRealtime {
  broadcast(event: GraphChangeEvent): void;
}

export interface GraphToolContext {
  repository: GraphRepository;
  realtime: GraphToolRealtime;
}

type ToolInputShape = z.ZodRawShape;
type GraphToolExecutor = (args: JsonMap, context: GraphToolContext) => unknown;

export interface GraphToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputShape;
  cliFields: string[];
  examples: string[];
  execute: GraphToolExecutor;
}

const jsonObjectSchema = z.record(z.string(), z.unknown());
const edgeDirectionSchema = z.enum(["directed", "bidirectional"]);
const optionalStringSchema = z.string().nullish();
const optionalJsonObjectSchema = jsonObjectSchema.nullish();

const getGraphInput: ToolInputShape = {
  includeTypes: z.boolean().nullish().describe("Optional no-op flag retained for compatibility with clients that reject empty tool schemas."),
};
const idInput: ToolInputShape = { id: z.string().min(1) };
const typeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  name: z.string().min(1),
  description: optionalStringSchema,
  immutable: z.boolean().nullish(),
  metadataSchema: optionalJsonObjectSchema,
};
const typeUpdateInput: ToolInputShape = {
  ...idInput,
  name: optionalStringSchema,
  description: optionalStringSchema,
  immutable: z.boolean().nullish(),
  metadataSchema: optionalJsonObjectSchema,
};
const nodeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  name: z.string().min(1),
  typeId: z.string().min(1),
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
};
const nodeUpdateInput: ToolInputShape = {
  ...idInput,
  name: optionalStringSchema,
  typeId: optionalStringSchema,
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
};
const edgeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  typeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  direction: edgeDirectionSchema,
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
};
const edgeUpdateInput: ToolInputShape = {
  ...idInput,
  typeId: optionalStringSchema,
  sourceNodeId: optionalStringSchema,
  targetNodeId: optionalStringSchema,
  direction: edgeDirectionSchema.nullish(),
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
};
const deleteInput: ToolInputShape = {
  ...idInput,
};

function broadcast(context: GraphToolContext, recordType: string, recordId: string, operation: string): void {
  context.realtime.broadcast({ type: "graph.changed", recordType, recordId, operation });
}

function mutate<T extends { record?: { id?: string }; deletedId?: string }>(
  context: GraphToolContext,
  recordType: string,
  operation: string,
  action: () => T,
): T {
  const result = action();
  broadcast(context, recordType, result.record?.id ?? result.deletedId ?? recordType, operation);
  return result;
}

function defineGraphTools<const T extends readonly GraphToolDefinition[]>(tools: T): T {
  return tools;
}

const typeCreateFields = ["id", "name", "description", "immutable", "metadataSchema"];
const typeUpdateFields = ["id", "name", "description", "immutable", "metadataSchema"];
const nodeCreateFields = ["id", "name", "typeId", "description", "metadata"];
const nodeUpdateFields = ["id", "name", "typeId", "description", "metadata"];
const edgeCreateFields = ["id", "typeId", "sourceNodeId", "targetNodeId", "direction", "description", "metadata"];
const edgeUpdateFields = ["id", "typeId", "sourceNodeId", "targetNodeId", "direction", "description", "metadata"];

export const graphTools = defineGraphTools([
  {
    name: "get_graph",
    title: "Get Graph",
    description: "Return the current Link graph snapshot.",
    inputSchema: getGraphInput,
    cliFields: ["includeTypes"],
    examples: ["link-cli graph get_graph"],
    execute: (_args, context) => context.repository.getSnapshot(),
  },
  {
    name: "search_graph",
    title: "Search Graph",
    description: "Search nodes, edges, node types, and edge types by text.",
    inputSchema: { query: z.string().nullish().describe("Search text. Empty or omitted text returns all searchable records.") },
    cliFields: ["query"],
    examples: ['link-cli graph search_graph --query "ada"'],
    execute: (args, context) => {
      if (String(args.query ?? "").trim() === "") {
        const snapshot = context.repository.getSnapshot();
        return { nodes: snapshot.nodes, nodeTypes: snapshot.nodeTypes, edgeTypes: snapshot.edgeTypes, edges: snapshot.edges };
      }
      return context.repository.search(String(args.query ?? ""));
    },
  },
  {
    name: "get_node_context",
    title: "Get Node Context",
    description: "Return one node and its directly connected edges and neighboring nodes.",
    inputSchema: { nodeId: z.string().min(1) },
    cliFields: ["nodeId"],
    examples: ["link-cli graph get_node_context --nodeId ada-lovelace"],
    execute: (args, context) => context.repository.getContext(String(args.nodeId ?? "")),
  },
  {
    name: "create_node",
    title: "Create Node",
    description: "Create a graph node.",
    inputSchema: nodeCreateInput,
    cliFields: nodeCreateFields,
    examples: ['link-cli graph create_node --json \'{"name":"Ada Lovelace","typeId":"person"}\''],
    execute: (args, context) => mutate(context, "node", "create", () => context.repository.createNode(parseNodeInput(args) as NodeInput)),
  },
  {
    name: "update_node",
    title: "Update Node",
    description: "Update an existing graph node.",
    inputSchema: nodeUpdateInput,
    cliFields: nodeUpdateFields,
    examples: ['link-cli graph update_node --id ada-lovelace --json \'{"description":"Updated"}\''],
    execute: (args, context) => mutate(context, "node", "update", () => context.repository.updateNode(requiredId(args), parseNodeInput(args, true))),
  },
  {
    name: "delete_node",
    title: "Delete Node",
    description: "Delete a graph node and its connected edges.",
    inputSchema: deleteInput,
    cliFields: ["id"],
    examples: ["link-cli graph delete_node --id ada-lovelace"],
    execute: (args, context) => mutate(context, "node", "delete", () => context.repository.deleteNode(requiredId(args))),
  },
  {
    name: "create_edge",
    title: "Create Edge",
    description: "Create a graph edge.",
    inputSchema: edgeCreateInput,
    cliFields: edgeCreateFields,
    examples: ['link-cli graph create_edge --json \'{"typeId":"works-on","sourceNodeId":"ada","targetNodeId":"link","direction":"directed"}\''],
    execute: (args, context) => mutate(context, "edge", "create", () => context.repository.createEdge(parseEdgeInput(args) as EdgeInput)),
  },
  {
    name: "update_edge",
    title: "Update Edge",
    description: "Update an existing graph edge.",
    inputSchema: edgeUpdateInput,
    cliFields: edgeUpdateFields,
    examples: ['link-cli graph update_edge --id ada-works-on-link --json \'{"description":"Updated"}\''],
    execute: (args, context) => mutate(context, "edge", "update", () => context.repository.updateEdge(requiredId(args), parseEdgeInput(args, true))),
  },
  {
    name: "delete_edge",
    title: "Delete Edge",
    description: "Delete a graph edge.",
    inputSchema: deleteInput,
    cliFields: ["id"],
    examples: ["link-cli graph delete_edge --id ada-works-on-link"],
    execute: (args, context) => mutate(context, "edge", "delete", () => context.repository.deleteEdge(requiredId(args))),
  },
  {
    name: "create_node_type",
    title: "Create Node Type",
    description: "Create a node type definition.",
    inputSchema: typeCreateInput,
    cliFields: typeCreateFields,
    examples: ['link-cli graph create_node_type --json \'{"name":"Person"}\''],
    execute: (args, context) => mutate(context, "nodeType", "create", () => context.repository.createNodeType(parseTypeInput(args) as TypeInput)),
  },
  {
    name: "update_node_type",
    title: "Update Node Type",
    description: "Update a node type definition.",
    inputSchema: typeUpdateInput,
    cliFields: typeUpdateFields,
    examples: ['link-cli graph update_node_type --id person --json \'{"description":"People"}\''],
    execute: (args, context) => mutate(context, "nodeType", "update", () => context.repository.updateNodeType(requiredId(args), parseTypeInput(args, true))),
  },
  {
    name: "delete_node_type",
    title: "Delete Node Type",
    description: "Delete a node type definition.",
    inputSchema: deleteInput,
    cliFields: ["id"],
    examples: ["link-cli graph delete_node_type --id person"],
    execute: (args, context) => mutate(context, "nodeType", "delete", () => context.repository.deleteNodeType(requiredId(args))),
  },
  {
    name: "create_edge_type",
    title: "Create Edge Type",
    description: "Create an edge type definition.",
    inputSchema: typeCreateInput,
    cliFields: typeCreateFields,
    examples: ['link-cli graph create_edge_type --json \'{"name":"Works On"}\''],
    execute: (args, context) => mutate(context, "edgeType", "create", () => context.repository.createEdgeType(parseTypeInput(args) as TypeInput)),
  },
  {
    name: "update_edge_type",
    title: "Update Edge Type",
    description: "Update an edge type definition.",
    inputSchema: typeUpdateInput,
    cliFields: typeUpdateFields,
    examples: ['link-cli graph update_edge_type --id works-on --json \'{"description":"Work relationship"}\''],
    execute: (args, context) => mutate(context, "edgeType", "update", () => context.repository.updateEdgeType(requiredId(args), parseTypeInput(args, true))),
  },
  {
    name: "delete_edge_type",
    title: "Delete Edge Type",
    description: "Delete an edge type definition.",
    inputSchema: deleteInput,
    cliFields: ["id"],
    examples: ["link-cli graph delete_edge_type --id works-on"],
    execute: (args, context) => mutate(context, "edgeType", "delete", () => context.repository.deleteEdgeType(requiredId(args))),
  },
] as const);

export type GraphToolName = (typeof graphTools)[number]["name"];

export const graphToolNames = graphTools.map(tool => tool.name) as GraphToolName[];

export function isGraphToolName(value: string): value is GraphToolName {
  return graphToolNames.includes(value as GraphToolName);
}

export function getGraphTool(name: GraphToolName): (typeof graphTools)[number] {
  return graphTools.find(tool => tool.name === name)!;
}

export function callGraphTool(name: string, args: JsonMap, context: GraphToolContext): unknown {
  if (!isGraphToolName(name)) {
    throw new GraphError("VALIDATION", "Unknown graph tool.", { name });
  }
  return getGraphTool(name).execute(args, context);
}
