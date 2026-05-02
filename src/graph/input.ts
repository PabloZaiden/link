import type { AuthProvider } from "../auth/actor";
import { GraphError } from "../domain/errors";
import type { EdgeDirection, Metadata, MetadataSchema, WriteOptions } from "../domain/types";
import type { EdgeInput, NodeInput, TypeInput } from "../storage/repository";

export interface JsonMap {
  [key: string]: unknown;
}

export function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(request: Request): Promise<JsonMap> {
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
  return value;
}

export function optionalString(body: JsonMap, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new GraphError("VALIDATION", `${field} must be a string.`, { field, value });
  return value;
}

export function requiredString(body: JsonMap, field: string): string {
  const value = optionalString(body, field);
  if (value === undefined) throw new GraphError("VALIDATION", `${field} is required.`, { field });
  return value;
}

export function optionalObject<T extends JsonMap>(body: JsonMap, field: string): T | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isJsonMap(value)) throw new GraphError("VALIDATION", `${field} must be an object.`, { field, value });
  return value as T;
}

export function requiredDirection(body: JsonMap): EdgeDirection {
  const direction = requiredString(body, "direction");
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

export function optionalDirection(body: JsonMap): EdgeDirection | undefined {
  const direction = optionalString(body, "direction");
  if (direction === undefined) return undefined;
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new GraphError("VALIDATION", "direction must be directed or bidirectional.", { direction });
  }
  return direction;
}

export function parseTypeInput(body: JsonMap, partial = false): Partial<TypeInput> | TypeInput {
  return {
    id: optionalString(body, "id"),
    name: partial ? optionalString(body, "name") : requiredString(body, "name"),
    description: optionalString(body, "description"),
    metadataSchema: optionalObject<MetadataSchema>(body, "metadataSchema"),
  };
}

export function parseNodeInput(body: JsonMap, partial = false): Partial<NodeInput> | NodeInput {
  return {
    id: optionalString(body, "id"),
    name: partial ? optionalString(body, "name") : requiredString(body, "name"),
    typeId: partial ? optionalString(body, "typeId") : requiredString(body, "typeId"),
    description: optionalString(body, "description"),
    metadata: optionalObject<Metadata>(body, "metadata"),
  };
}

export function parseEdgeInput(body: JsonMap, partial = false): Partial<EdgeInput> | EdgeInput {
  return {
    id: optionalString(body, "id"),
    typeId: partial ? optionalString(body, "typeId") : requiredString(body, "typeId"),
    sourceNodeId: partial ? optionalString(body, "sourceNodeId") : requiredString(body, "sourceNodeId"),
    targetNodeId: partial ? optionalString(body, "targetNodeId") : requiredString(body, "targetNodeId"),
    direction: partial ? optionalDirection(body) : requiredDirection(body),
    description: optionalString(body, "description"),
    metadata: optionalObject<Metadata>(body, "metadata"),
  };
}

export function requiredId(args: JsonMap, field = "id"): string {
  return requiredString(args, field);
}

export function expectedVersionFromValue(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    throw new GraphError("VALIDATION", "Mutations require a non-negative integer expectedVersion.", { expectedVersion: value });
  }
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new GraphError("VALIDATION", "Mutations require a non-negative integer expectedVersion.", { expectedVersion: value });
  }
  return version;
}

export function expectedVersionFrom(request: Request, body: JsonMap): number {
  const fromBody = body.expectedVersion;
  const fromQuery = new URL(request.url).searchParams.get("expectedVersion");
  return expectedVersionFromValue(fromBody ?? fromQuery);
}

export function writeOptions(request: Request, body: JsonMap, auth: AuthProvider): WriteOptions {
  return {
    expectedVersion: expectedVersionFrom(request, body),
    actor: auth.actorForRequest(request),
  };
}
