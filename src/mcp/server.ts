import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GraphError } from "../domain/errors";
import { isJsonMap } from "../graph/input";
import { callGraphTool, graphTools, type JsonMap } from "../graph/tools";
import type { RealtimeHub } from "../realtime/hub";
import type { GraphRepository } from "../storage/repository";

export const linkMcpTools = graphTools;

export function createLinkMcpServer(deps: { repository: GraphRepository; realtime: RealtimeHub; request: Request }): McpServer {
  const server = new McpServer(
    { name: "link", version: "0.1.0" },
    {
      instructions:
        "Use Link tools to read and update a local Git-backed graph of work-related entities. Mutations are local-only and do not require auth or expectedVersion.",
    },
  );

  for (const tool of graphTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => {
        try {
          const result = callGraphTool(tool.name, args as JsonMap, {
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
