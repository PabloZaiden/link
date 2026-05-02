export type GraphErrorCode = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "DUPLICATE" | "CONFIG";

export class GraphError extends Error {
  constructor(
    public readonly code: GraphErrorCode,
    message: string,
    public readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function validationError(message: string, details?: unknown): GraphError {
  return new GraphError("VALIDATION", message, details);
}

export function notFoundError(message: string, details?: unknown): GraphError {
  return new GraphError("NOT_FOUND", message, details);
}

export function conflictError(message: string, details?: unknown): GraphError {
  return new GraphError("CONFLICT", message, details);
}

export function duplicateError(message: string, details?: unknown): GraphError {
  return new GraphError("DUPLICATE", message, details);
}

export function configError(message: string, details?: unknown): GraphError {
  return new GraphError("CONFIG", message, details);
}

