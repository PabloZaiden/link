import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import { GraphError } from "../domain/errors";
import { isJsonMap } from "../graph/input";
import type { RealtimeHub } from "../realtime/hub";
import type { GraphRepository } from "../storage/repository";
import { callLinkTool, type JsonMap, type LinkMcpToolName, linkMcpToolNames } from "./tools";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const edgeDirectionSchema = z.enum(["directed", "bidirectional"]);
const optionalStringSchema = z.string().nullish();
const optionalJsonObjectSchema = jsonObjectSchema.nullish();

type ToolInputShape = z.ZodRawShape;

interface LinkToolDefinition {
  name: LinkMcpToolName;
  title: string;
  description: string;
  inputSchema: ToolInputShape;
}

const getGraphInput: ToolInputShape = {
  includeTypes: z.boolean().nullish().describe("Optional no-op flag retained for compatibility with clients that reject empty tool schemas."),
};
const idInput: ToolInputShape = { id: z.string().min(1) };
const typeCreateInput: ToolInputShape = {
  id: optionalStringSchema,
  name: z.string().min(1),
  description: optionalStringSchema,
  metadataSchema: optionalJsonObjectSchema,
};
const typeUpdateInput: ToolInputShape = {
  ...idInput,
  name: optionalStringSchema,
  description: optionalStringSchema,
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

export const linkMcpTools: LinkToolDefinition[] = [
  { name: "get_graph", title: "Get Graph", description: "Return the current Link graph snapshot.", inputSchema: getGraphInput },
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
  { name: "delete_node", title: "Delete Node", description: "Delete a graph node and its connected edges.", inputSchema: deleteInput },
  { name: "create_edge", title: "Create Edge", description: "Create a graph edge.", inputSchema: edgeCreateInput },
  { name: "update_edge", title: "Update Edge", description: "Update an existing graph edge.", inputSchema: edgeUpdateInput },
  { name: "delete_edge", title: "Delete Edge", description: "Delete a graph edge.", inputSchema: deleteInput },
  { name: "create_node_type", title: "Create Node Type", description: "Create a node type definition.", inputSchema: typeCreateInput },
  { name: "update_node_type", title: "Update Node Type", description: "Update a node type definition.", inputSchema: typeUpdateInput },
  { name: "delete_node_type", title: "Delete Node Type", description: "Delete a node type definition.", inputSchema: deleteInput },
  { name: "create_edge_type", title: "Create Edge Type", description: "Create an edge type definition.", inputSchema: typeCreateInput },
  { name: "update_edge_type", title: "Update Edge Type", description: "Update an edge type definition.", inputSchema: typeUpdateInput },
  { name: "delete_edge_type", title: "Delete Edge Type", description: "Delete an edge type definition.", inputSchema: deleteInput },
];

if (linkMcpTools.map(tool => tool.name).join("\n") !== linkMcpToolNames.join("\n")) {
  throw new Error("Link MCP tool registry is out of sync with tool executor names.");
}

export function createLinkMcpServer(deps: { repository: GraphRepository; realtime: RealtimeHub; request: Request }): McpServer {
  const server = new McpServer(
    { name: "link", version: "0.1.0" },
    {
      instructions:
        "Use Link tools to read and update a local Git-backed graph of work-related entities. Mutations are local-only and do not require auth or expectedVersion.",
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

export async function handleMcpRequest(deps: { repository: GraphRepository; realtime: RealtimeHub; request: Request }): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  const server = createLinkMcpServer(deps);
  await server.connect(transport);
  return transport.handleRequest(deps.request);
}
