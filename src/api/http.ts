import type { BunFile, HTMLBundle } from "bun";
import { GraphError } from "../domain/errors";
import type { FullGraphExport } from "../domain/types";
import type { AuthProvider } from "../auth/actor";
import type { RealtimeHub } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";
import type { AppConfig } from "../server/config";
import { handleMcpRequest } from "../mcp/server";
import { parseEdgeInput, parseNodeInput, parseTypeInput, readJson, writeOptions } from "../graph/input";

function defineRoutes<const RoutePath extends string>(routes: Bun.Serve.RoutesWithUpgrade<undefined, RoutePath>) {
  return routes;
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
  index: Response | BunFile | HTMLBundle;
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
        const input = parseTypeInput(body) as TypeInput;
        return mutation(() => repository.createNodeType(input, options), realtime, "nodeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Node type ID is required.");
      if (operation === "update") {
        const input = parseTypeInput(body, true);
        return mutation(() => repository.updateNodeType(id, input, options), realtime, "nodeType", "update");
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
        const input = parseTypeInput(body) as TypeInput;
        return mutation(() => repository.createEdgeType(input, options), realtime, "edgeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Edge type ID is required.");
      if (operation === "update") {
        const input = parseTypeInput(body, true);
        return mutation(() => repository.updateEdgeType(id, input, options), realtime, "edgeType", "update");
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
      if (operation === "create") {
        const input = parseNodeInput(body) as NodeInput;
        return mutation(() => repository.createNode(input, options), realtime, "node", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Node ID is required.");
      if (operation === "update") {
        const input = parseNodeInput(body, true);
        return mutation(() => repository.updateNode(id, input, options), realtime, "node", "update");
      }
      return mutation(() => repository.deleteNode(id, options), realtime, "node", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function edgeMutation(request: Request, operation: "create" | "update" | "delete", id?: string): Promise<Response> {
    try {
      const body = await readJson(request);
      const options = writeOptions(request, body, auth);
      if (operation === "create") {
        const input = parseEdgeInput(body) as EdgeInput;
        return mutation(() => repository.createEdge(input, options), realtime, "edge", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Edge ID is required.");
      if (operation === "update") {
        const input = parseEdgeInput(body, true);
        return mutation(() => repository.updateEdge(id, input, options), realtime, "edge", "update");
      }
      return mutation(() => repository.deleteEdge(id, options), realtime, "edge", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  return defineRoutes({
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
      PUT: request => nodeTypeMutation(request, "update", request.params.id),
      DELETE: request => nodeTypeMutation(request, "delete", request.params.id),
    },
    "/api/edge-types": {
      GET: () => json(repository.getSnapshot().edgeTypes),
      POST: (request: Request) => edgeTypeMutation(request, "create"),
    },
    "/api/edge-types/:id": {
      PUT: request => edgeTypeMutation(request, "update", request.params.id),
      DELETE: request => edgeTypeMutation(request, "delete", request.params.id),
    },
    "/api/nodes": {
      GET: () => json(repository.getSnapshot().nodes),
      POST: (request: Request) => nodeMutation(request, "create"),
    },
    "/api/nodes/:id": {
      GET: request => {
        try {
          return json(repository.getContext(request.params.id).node);
        } catch (error) {
          return errorResponse(error);
        }
      },
      PUT: request => nodeMutation(request, "update", request.params.id),
      DELETE: request => nodeMutation(request, "delete", request.params.id),
    },
    "/api/edges": {
      GET: () => json(repository.getSnapshot().edges),
      POST: (request: Request) => edgeMutation(request, "create"),
    },
    "/api/edges/:id": {
      GET: request => {
        try {
          const edge = repository.getSnapshot().edges.find(candidate => candidate.id === request.params.id);
          if (!edge) throw new GraphError("NOT_FOUND", "Edge not found.", { id: request.params.id });
          return json(edge);
        } catch (error) {
          return errorResponse(error);
        }
      },
      PUT: request => edgeMutation(request, "update", request.params.id),
      DELETE: request => edgeMutation(request, "delete", request.params.id),
    },
    "/api/search": {
      GET: (request: Request) => json(repository.search(new URL(request.url).searchParams.get("q") ?? "")),
    },
    "/api/nodes/:id/context": {
      GET: request => {
        try {
          return json(repository.getContext(request.params.id));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
    "/api/history": { GET: () => json(repository.getHistory()) },
    "/api/history/:version": {
      GET: request => {
        try {
          const version = Number(request.params.version);
          if (!Number.isInteger(version) || version < 0) {
            throw new GraphError("VALIDATION", "History version must be a non-negative integer.", { version: request.params.version });
          }
          const change = repository.getHistoryVersion(version);
          return change ? json(change) : json({ error: { code: "NOT_FOUND", message: "History version not found." } }, { status: 404 });
        } catch (error) {
          return errorResponse(error);
        }
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
        try {
          if (!config.adminEnabled) return json({ error: { code: "NOT_FOUND", message: "Admin endpoints are disabled." } }, { status: 404 });
          const snapshot = repository.getSnapshot();
          if (snapshot.nodeTypes.length > 0 || snapshot.edgeTypes.length > 0) {
            throw new GraphError("CONFLICT", "Bootstrap types can only be seeded when no types exist.");
          }

          const seededSnapshot = repository.seedBootstrap(auth.actorForRequest(request));
          realtime.broadcast({ type: "graph.changed", version: seededSnapshot.version, recordType: "graph", recordId: "bootstrap", operation: "seed" });
          return json(seededSnapshot);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
    "/api/realtime": {
      GET: (request, server) => {
        if (server.upgrade(request)) return undefined;
        return new Response("Expected WebSocket upgrade.", { status: 400 });
      },
    },
    "/mcp": {
      GET: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
      POST: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
      DELETE: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
    },
    "/*": index,
  });
}
