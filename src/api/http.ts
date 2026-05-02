import { GraphError } from "../domain/errors";
import type { EdgeDirection, FullGraphExport, Metadata, MetadataSchema, WriteOptions } from "../domain/types";
import type { AuthProvider } from "../auth/actor";
import type { RealtimeHub } from "../realtime/hub";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "../storage/repository";
import type { AppConfig } from "../server/config";
import { handleMcpRequest } from "../mcp/server";

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
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GraphError("VALIDATION", "Request body must be valid JSON.");
    }
    throw error;
  }
  if (!isJsonMap(value)) throw new GraphError("VALIDATION", "Request body must be a JSON object.");
  return value as JsonMap;
}

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(body: JsonMap, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new GraphError("VALIDATION", `${field} must be a string.`, { field, value });
  return value;
}

function requiredString(body: JsonMap, field: string): string {
  const value = optionalString(body, field);
  if (value === undefined) throw new GraphError("VALIDATION", `${field} is required.`, { field });
  return value;
}

function optionalObject<T extends JsonMap>(body: JsonMap, field: string): T | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isJsonMap(value)) throw new GraphError("VALIDATION", `${field} must be an object.`, { field, value });
  return value as T;
}

function requiredDirection(body: JsonMap): EdgeDirection {
  const direction = requiredString(body, "direction");
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

function optionalDirection(body: JsonMap): EdgeDirection | undefined {
  const direction = optionalString(body, "direction");
  if (direction === undefined) return undefined;
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

function parseTypeInput(body: JsonMap, partial = false): Partial<TypeInput> | TypeInput {
  const input: Partial<TypeInput> = {
    id: optionalString(body, "id"),
    name: partial ? optionalString(body, "name") : requiredString(body, "name"),
    description: optionalString(body, "description"),
    metadataSchema: optionalObject<MetadataSchema>(body, "metadataSchema"),
  };
  return input;
}

function parseNodeInput(body: JsonMap, partial = false): Partial<NodeInput> | NodeInput {
  const input: Partial<NodeInput> = {
    id: optionalString(body, "id"),
    name: partial ? optionalString(body, "name") : requiredString(body, "name"),
    typeId: partial ? optionalString(body, "typeId") : requiredString(body, "typeId"),
    description: optionalString(body, "description"),
    metadata: optionalObject<Metadata>(body, "metadata"),
  };
  return input;
}

function parseEdgeInput(body: JsonMap, partial = false): Partial<EdgeInput> | EdgeInput {
  const input: Partial<EdgeInput> = {
    id: optionalString(body, "id"),
    typeId: partial ? optionalString(body, "typeId") : requiredString(body, "typeId"),
    sourceNodeId: partial ? optionalString(body, "sourceNodeId") : requiredString(body, "sourceNodeId"),
    targetNodeId: partial ? optionalString(body, "targetNodeId") : requiredString(body, "targetNodeId"),
    direction: partial ? optionalDirection(body) : requiredDirection(body),
    description: optionalString(body, "description"),
    metadata: optionalObject<Metadata>(body, "metadata"),
  };
  return input;
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

function expectedVersionFrom(request: Request, body: JsonMap): number {
  const fromBody = body.expectedVersion;
  const fromQuery = new URL(request.url).searchParams.get("expectedVersion");
  return expectedVersionFromValue(fromBody ?? fromQuery);
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
      GET: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
      POST: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
      DELETE: (request: Request) => handleMcpRequest({ repository, auth, realtime, request }),
    },
    "/*": index,
  };
}
