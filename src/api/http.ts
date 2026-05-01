import { GraphError } from "../domain/errors";
import type { Actor, FullGraphExport, WriteOptions } from "../domain/types";
import type { AuthProvider } from "../auth/actor";
import type { RealtimeHub } from "../realtime/hub";
import type { GraphRepository } from "../storage/repository";
import type { AppConfig } from "../server/config";

interface JsonMap {
  [key: string]: unknown;
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function errorResponse(error: unknown): Response {
  if (error instanceof GraphError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" || error.code === "DUPLICATE" ? 409 : 400;
    return json({ error: { code: error.code, message: error.message, details: error.details } }, { status });
  }
  console.error(error);
  return json({ error: { code: "INTERNAL", message: "Unexpected server error." } }, { status: 500 });
}

async function readJson(request: Request): Promise<JsonMap> {
  const text = await request.text();
  if (!text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as JsonMap;
}

function expectedVersionFrom(request: Request, body: JsonMap): number {
  const fromBody = body.expectedVersion;
  const fromQuery = new URL(request.url).searchParams.get("expectedVersion");
  const value = fromBody ?? fromQuery;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new GraphError("VALIDATION", "Mutations require a non-negative integer expectedVersion.", { expectedVersion: value });
  }
  return version;
}

function writeOptions(request: Request, body: JsonMap, auth: AuthProvider): WriteOptions {
  return {
    expectedVersion: expectedVersionFrom(request, body),
    actor: auth.actorForRequest(request),
  };
}

function broadcast(hub: RealtimeHub, version: number, recordType: string, recordId: string, operation: string): void {
  hub.broadcast({ type: "graph.changed", version, recordType, recordId, operation });
}

function mutation<T>(
  action: () => { version: number; record?: T; deletedId?: string },
  hub: RealtimeHub,
  recordType: string,
  operation: string,
): Response {
  const result = action();
  const record = result.record as { id?: string } | undefined;
  const recordId = record?.id ?? result.deletedId ?? recordType;
  broadcast(hub, result.version, recordType, recordId, operation);
  return json(result, { status: operation === "create" ? 201 : 200 });
}

export function createRoutes(deps: {
  repository: GraphRepository;
  auth: AuthProvider;
  realtime: RealtimeHub;
  config: AppConfig;
  index: Response | Blob | HTMLBundle;
}) {
  const { repository, auth, realtime, config, index } = deps;

  async function nodeTypeMutation(
    request: Request,
    operation: "create" | "update" | "delete",
    id?: string,
  ): Promise<Response> {
    try {
      const body = await readJson(request);
      const options = writeOptions(request, body, auth);
      if (operation === "create") {
        return mutation(() => repository.createNodeType(body, options), realtime, "nodeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Node type ID is required.");
      if (operation === "update") {
        return mutation(() => repository.updateNodeType(id, body, options), realtime, "nodeType", "update");
      }
      return mutation(() => repository.deleteNodeType(id, options), realtime, "nodeType", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function edgeTypeMutation(
    request: Request,
    operation: "create" | "update" | "delete",
    id?: string,
  ): Promise<Response> {
    try {
      const body = await readJson(request);
      const options = writeOptions(request, body, auth);
      if (operation === "create") {
        return mutation(() => repository.createEdgeType(body, options), realtime, "edgeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Edge type ID is required.");
      if (operation === "update") {
        return mutation(() => repository.updateEdgeType(id, body, options), realtime, "edgeType", "update");
      }
      return mutation(() => repository.deleteEdgeType(id, options), realtime, "edgeType", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function nodeMutation(request: Request, operation: "create" | "update" | "delete", id?: string): Promise<Response> {
    try {
      const body = await readJson(request);
      const options = writeOptions(request, body, auth);
      if (operation === "create") return mutation(() => repository.createNode(body, options), realtime, "node", "create");
      if (!id) throw new GraphError("VALIDATION", "Node ID is required.");
      if (operation === "update") return mutation(() => repository.updateNode(id, body, options), realtime, "node", "update");
      return mutation(() => repository.deleteNode(id, options), realtime, "node", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function edgeMutation(request: Request, operation: "create" | "update" | "delete", id?: string): Promise<Response> {
    try {
      const body = await readJson(request);
      const options = writeOptions(request, body, auth);
      if (operation === "create") return mutation(() => repository.createEdge(body, options), realtime, "edge", "create");
      if (!id) throw new GraphError("VALIDATION", "Edge ID is required.");
      if (operation === "update") return mutation(() => repository.updateEdge(id, body, options), realtime, "edge", "update");
      return mutation(() => repository.deleteEdge(id, options), realtime, "edge", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function mcp(request: Request): Promise<Response> {
    try {
      const body = await readJson(request);
      if (body.jsonrpc === "2.0" && body.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
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
            ].map(name => ({ name })),
          },
        });
      }
      const toolName = body.method === "tools/call" ? (body.params as JsonMap | undefined)?.name : body.tool;
      const args = (body.method === "tools/call" ? (body.params as JsonMap | undefined)?.arguments : body.args) as JsonMap | undefined;
      const result = callTool(String(toolName), args ?? {}, request);
      if (body.jsonrpc === "2.0") return json({ jsonrpc: "2.0", id: body.id, result });
      return json({ result });
    } catch (error) {
      return errorResponse(error);
    }
  }

  function callTool(name: string, args: JsonMap, request: Request): unknown {
    const actor: Actor = auth.actorForRequest(request);
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
        return mutate("nodeType", "create", () => repository.createNodeType(args, { expectedVersion: Number(args.expectedVersion), actor }));
      case "update_node_type":
        return mutate("nodeType", "update", () =>
          repository.updateNodeType(String(args.id ?? ""), args, { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "delete_node_type":
        return mutate("nodeType", "delete", () =>
          repository.deleteNodeType(String(args.id ?? ""), { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "create_edge_type":
        return mutate("edgeType", "create", () => repository.createEdgeType(args, { expectedVersion: Number(args.expectedVersion), actor }));
      case "update_edge_type":
        return mutate("edgeType", "update", () =>
          repository.updateEdgeType(String(args.id ?? ""), args, { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "delete_edge_type":
        return mutate("edgeType", "delete", () =>
          repository.deleteEdgeType(String(args.id ?? ""), { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "create_node":
        return mutate("node", "create", () => repository.createNode(args, { expectedVersion: Number(args.expectedVersion), actor }));
      case "update_node":
        return mutate("node", "update", () =>
          repository.updateNode(String(args.id ?? ""), args, { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "delete_node":
        return mutate("node", "delete", () => repository.deleteNode(String(args.id ?? ""), { expectedVersion: Number(args.expectedVersion), actor }));
      case "create_edge":
        return mutate("edge", "create", () => repository.createEdge(args, { expectedVersion: Number(args.expectedVersion), actor }));
      case "update_edge":
        return mutate("edge", "update", () =>
          repository.updateEdge(String(args.id ?? ""), args, { expectedVersion: Number(args.expectedVersion), actor }),
        );
      case "delete_edge":
        return mutate("edge", "delete", () => repository.deleteEdge(String(args.id ?? ""), { expectedVersion: Number(args.expectedVersion), actor }));
      default:
        throw new GraphError("VALIDATION", "Unknown MCP tool.", { name });
    }
  }

  return {
    "/api/health": {
      GET: () =>
        json({
          ok: true,
          version: repository.getSnapshot().version,
          databaseProvider: config.databaseProvider,
          authMode: config.authMode,
        }),
    },
    "/api/graph": { GET: () => json(repository.getSnapshot()) },
    "/api/node-types": {
      GET: () => json(repository.getSnapshot().nodeTypes),
      POST: (request: Request) => nodeTypeMutation(request, "create"),
    },
    "/api/node-types/:id": {
      PUT: (request: Request) => nodeTypeMutation(request, "update", request.params.id),
      DELETE: (request: Request) => nodeTypeMutation(request, "delete", request.params.id),
    },
    "/api/edge-types": {
      GET: () => json(repository.getSnapshot().edgeTypes),
      POST: (request: Request) => edgeTypeMutation(request, "create"),
    },
    "/api/edge-types/:id": {
      PUT: (request: Request) => edgeTypeMutation(request, "update", request.params.id),
      DELETE: (request: Request) => edgeTypeMutation(request, "delete", request.params.id),
    },
    "/api/nodes": {
      GET: () => json(repository.getSnapshot().nodes),
      POST: (request: Request) => nodeMutation(request, "create"),
    },
    "/api/nodes/:id": {
      GET: (request: Request) => {
        try {
          return json(repository.getContext(request.params.id).node);
        } catch (error) {
          return errorResponse(error);
        }
      },
      PUT: (request: Request) => nodeMutation(request, "update", request.params.id),
      DELETE: (request: Request) => nodeMutation(request, "delete", request.params.id),
    },
    "/api/edges": {
      GET: () => json(repository.getSnapshot().edges),
      POST: (request: Request) => edgeMutation(request, "create"),
    },
    "/api/edges/:id": {
      GET: (request: Request) => {
        try {
          const edge = repository.getSnapshot().edges.find(candidate => candidate.id === request.params.id);
          if (!edge) throw new GraphError("NOT_FOUND", "Edge not found.", { id: request.params.id });
          return json(edge);
        } catch (error) {
          return errorResponse(error);
        }
      },
      PUT: (request: Request) => edgeMutation(request, "update", request.params.id),
      DELETE: (request: Request) => edgeMutation(request, "delete", request.params.id),
    },
    "/api/search": {
      GET: (request: Request) => json(repository.search(new URL(request.url).searchParams.get("q") ?? "")),
    },
    "/api/nodes/:id/context": {
      GET: (request: Request) => {
        try {
          return json(repository.getContext(request.params.id));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
    "/api/history": { GET: () => json(repository.getHistory()) },
    "/api/history/:version": {
      GET: (request: Request) => {
        const change = repository.getHistoryVersion(Number(request.params.version));
        return change ? json(change) : json({ error: { code: "NOT_FOUND", message: "History version not found." } }, { status: 404 });
      },
    },
    "/api/export": { GET: () => json(repository.exportGraph()) },
    "/api/import": {
      POST: async (request: Request) => {
        try {
          const body = (await readJson(request)) as unknown as FullGraphExport;
          const snapshot = repository.importGraph(body, auth.actorForRequest(request));
          realtime.broadcast({ type: "graph.changed", version: snapshot.version, recordType: "graph", recordId: "full", operation: "import" });
          return json(snapshot);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
    "/api/admin/seed/bootstrap": {
      POST: (request: Request) => {
        if (!config.adminEnabled) return json({ error: { code: "NOT_FOUND", message: "Admin endpoints are disabled." } }, { status: 404 });
        const snapshot = repository.seedBootstrap(auth.actorForRequest(request));
        realtime.broadcast({ type: "graph.changed", version: snapshot.version, recordType: "graph", recordId: "bootstrap", operation: "seed" });
        return json(snapshot);
      },
    },
    "/api/realtime": {
      GET: (request: Request, server: Server) => {
        if (server.upgrade(request)) return undefined;
        return new Response("Expected WebSocket upgrade.", { status: 400 });
      },
    },
    "/mcp": {
      GET: () => json({ name: "link", toolsEndpoint: "/mcp", protocol: "json-rpc-tools" }),
      POST: mcp,
    },
    "/*": index,
  };
}
