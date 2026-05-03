import type { BunFile, HTMLBundle } from "bun";
import { GraphError } from "../domain/errors";
import type { RealtimeHub } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";
import type { AppConfig } from "../server/config";
import { handleMcpRequest } from "../mcp/server";
import { parseEdgeInput, parseNodeInput, parseTypeInput, readJson } from "../graph/input";

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

function broadcast(hub: RealtimeHub, recordType: string, recordId: string, operation: string): void {
  hub.broadcast({ type: "graph.changed", recordType, recordId, operation });
}

function mutation<T>(
  action: () => { record?: T; deletedId?: string },
  hub: RealtimeHub,
  recordType: string,
  operation: string,
): Response {
  const result = action();
  const record = result.record as { id?: string } | undefined;
  const recordId = record?.id ?? result.deletedId ?? recordType;
  broadcast(hub, recordType, recordId, operation);
  return json(result, { status: operation === "create" ? 201 : 200 });
}

export function createRoutes(deps: {
  repository: GraphRepository;
  realtime: RealtimeHub;
  config: AppConfig;
  index: Response | BunFile | HTMLBundle;
}) {
  const { repository, realtime, config, index } = deps;

  async function nodeTypeMutation(
    request: Request,
    operation: "create" | "update" | "delete",
    id?: string,
  ): Promise<Response> {
    try {
      const body = await readJson(request);
      if (operation === "create") {
        const input = parseTypeInput(body) as TypeInput;
        return mutation(() => repository.createNodeType(input), realtime, "nodeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Node type ID is required.");
      if (operation === "update") {
        const input = parseTypeInput(body, true);
        return mutation(() => repository.updateNodeType(id, input), realtime, "nodeType", "update");
      }
      return mutation(() => repository.deleteNodeType(id), realtime, "nodeType", "delete");
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
      if (operation === "create") {
        const input = parseTypeInput(body) as TypeInput;
        return mutation(() => repository.createEdgeType(input), realtime, "edgeType", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Edge type ID is required.");
      if (operation === "update") {
        const input = parseTypeInput(body, true);
        return mutation(() => repository.updateEdgeType(id, input), realtime, "edgeType", "update");
      }
      return mutation(() => repository.deleteEdgeType(id), realtime, "edgeType", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function nodeMutation(request: Request, operation: "create" | "update" | "delete", id?: string): Promise<Response> {
    try {
      const body = await readJson(request);
      if (operation === "create") {
        const input = parseNodeInput(body) as NodeInput;
        return mutation(() => repository.createNode(input), realtime, "node", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Node ID is required.");
      if (operation === "update") {
        const input = parseNodeInput(body, true);
        return mutation(() => repository.updateNode(id, input), realtime, "node", "update");
      }
      return mutation(() => repository.deleteNode(id), realtime, "node", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function edgeMutation(request: Request, operation: "create" | "update" | "delete", id?: string): Promise<Response> {
    try {
      const body = await readJson(request);
      if (operation === "create") {
        const input = parseEdgeInput(body) as EdgeInput;
        return mutation(() => repository.createEdge(input), realtime, "edge", "create");
      }
      if (!id) throw new GraphError("VALIDATION", "Edge ID is required.");
      if (operation === "update") {
        const input = parseEdgeInput(body, true);
        return mutation(() => repository.updateEdge(id, input), realtime, "edge", "update");
      }
      return mutation(() => repository.deleteEdge(id), realtime, "edge", "delete");
    } catch (error) {
      return errorResponse(error);
    }
  }

  return defineRoutes({
    "/api/health": {
      GET: () =>
        json({
          ok: true,
          graphPath: config.graphPath,
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
    "/api/realtime": {
      GET: (request, server) => {
        if (server.upgrade(request)) return undefined;
        return new Response("Expected WebSocket upgrade.", { status: 400 });
      },
    },
    "/mcp": {
      GET: (request: Request) => handleMcpRequest({ repository, realtime, request }),
      POST: (request: Request) => handleMcpRequest({ repository, realtime, request }),
      DELETE: (request: Request) => handleMcpRequest({ repository, realtime, request }),
    },
    "/*": index,
  });
}
