import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import type { AuthProvider } from "../auth/actor";
import { GraphError } from "../domain/errors";
import { isJsonMap } from "../graph/input";
import type { RealtimeHub } from "../realtime/hub";
import type { GraphRepository } from "../storage/repository";
import { callLinkTool, type JsonMap, type LinkMcpToolName, linkMcpToolNames } from "./tools";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const edgeDirectionSchema = z.enum(["directed", "bidirectional"]);
const optionalStringSchema = z.string().nullish();
const optionalJsonObjectSchema = jsonObjectSchema.nullish();
const expectedVersionSchema = z
  .union([z.number(), z.string()])
  .refine(value => value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0, "Expected a non-negative integer.")
  .transform(value => Number(value))
  .describe("Latest graph version observed before making this mutation.");

type ToolInputShape = z.ZodRawShape;

interface LinkToolDefinition {
  name: LinkMcpToolName;
  title: string;
  description: string;
  inputSchema: ToolInputShape;
}

const emptyInput: ToolInputShape = {};
const idInput: ToolInputShape = { id: z.string().min(1) };
const expectedVersionInput: ToolInputShape = { expectedVersion: expectedVersionSchema };
const typeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  name: z.string().min(1),
  description: optionalStringSchema,
  metadataSchema: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const typeUpdateInput: ToolInputShape = {
  ...idInput,
  name: optionalStringSchema,
  description: optionalStringSchema,
  metadataSchema: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const nodeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  name: z.string().min(1),
  typeId: z.string().min(1),
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const nodeUpdateInput: ToolInputShape = {
  ...idInput,
  name: optionalStringSchema,
  typeId: optionalStringSchema,
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const edgeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  typeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  direction: edgeDirectionSchema,
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const edgeUpdateInput: ToolInputShape = {
  ...idInput,
  typeId: optionalStringSchema,
  sourceNodeId: optionalStringSchema,
  targetNodeId: optionalStringSchema,
  direction: edgeDirectionSchema.nullish(),
  description: optionalStringSchema,
  metadata: optionalJsonObjectSchema,
  ...expectedVersionInput,
};
const deleteInput: ToolInputShape = {
  ...idInput,
  ...expectedVersionInput,
};

export const linkMcpTools: LinkToolDefinition[] = [
  { name: "get_graph", title: "Get Graph", description: "Return the current Link graph snapshot.", inputSchema: emptyInput },
  {
    name: "search_graph",
    title: "Search Graph",
    description: "Search nodes, edges, node types, and edge types by text.",
    inputSchema: { query: z.string().nullish().describe("Search text. Empty or omitted text returns all searchable records.") },
  },
  {
    name: "get_node_context",
    title: "Get Node Context",
    description: "Return one node and its directly connected edges and neighboring nodes.",
    inputSchema: { nodeId: z.string().min(1) },
  },
  { name: "create_node", title: "Create Node", description: "Create a graph node.", inputSchema: nodeCreateInput },
  { name: "update_node", title: "Update Node", description: "Update an existing graph node.", inputSchema: nodeUpdateInput },
  { name: "delete_node", title: "Delete Node", description: "Delete a graph node using Link tombstone semantics.", inputSchema: deleteInput },
  { name: "create_edge", title: "Create Edge", description: "Create a graph edge.", inputSchema: edgeCreateInput },
  { name: "update_edge", title: "Update Edge", description: "Update an existing graph edge.", inputSchema: edgeUpdateInput },
  { name: "delete_edge", title: "Delete Edge", description: "Delete a graph edge using Link tombstone semantics.", inputSchema: deleteInput },
  { name: "create_node_type", title: "Create Node Type", description: "Create a node type definition.", inputSchema: typeCreateInput },
  { name: "update_node_type", title: "Update Node Type", description: "Update a node type definition.", inputSchema: typeUpdateInput },
  { name: "delete_node_type", title: "Delete Node Type", description: "Delete a node type definition.", inputSchema: deleteInput },
  { name: "create_edge_type", title: "Create Edge Type", description: "Create an edge type definition.", inputSchema: typeCreateInput },
  { name: "update_edge_type", title: "Update Edge Type", description: "Update an edge type definition.", inputSchema: typeUpdateInput },
  { name: "delete_edge_type", title: "Delete Edge Type", description: "Delete an edge type definition.", inputSchema: deleteInput },
  { name: "get_history", title: "Get History", description: "Return append-only graph change history.", inputSchema: emptyInput },
  { name: "export_graph", title: "Export Graph", description: "Return a full graph export including tombstones and history.", inputSchema: emptyInput },
];

if (linkMcpTools.map(tool => tool.name).join("\n") !== linkMcpToolNames.join("\n")) {
  throw new Error("Link MCP tool registry is out of sync with tool executor names.");
}

export function createLinkMcpServer(deps: { repository: GraphRepository; auth: AuthProvider; realtime: RealtimeHub; request: Request }): McpServer {
  const server = new McpServer(
    { name: "link", version: "0.1.0" },
    {
      instructions:
        "Use Link tools to read and update a small graph of work-related entities. Include expectedVersion from the latest graph snapshot for every mutation.",
    },
  );

  for (const tool of linkMcpTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async args => {
        try {
          const result = callLinkTool(tool.name, args as JsonMap, {
            repository: deps.repository,
            realtime: deps.realtime,
            actor: deps.auth.actorForRequest(deps.request),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: isJsonMap(result) ? result : { result },
          };
        } catch (error) {
          if (error instanceof GraphError) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: JSON.stringify({ code: error.code, message: error.message, details: error.details }) }],
            };
          }
          throw error;
        }
      },
    );
  }

  return server;
}

export async function handleMcpRequest(deps: { repository: GraphRepository; auth: AuthProvider; realtime: RealtimeHub; request: Request }): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  const server = createLinkMcpServer(deps);
  await server.connect(transport);
  return transport.handleRequest(deps.request);
}
