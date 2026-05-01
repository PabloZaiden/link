import { configError } from "../domain/errors";
import type { Actor } from "../domain/types";

export interface AuthProvider {
  actorForRequest(request: Request): Actor;
}

export class NoAuthProvider implements AuthProvider {
  actorForRequest(): Actor {
    return { id: "local", displayName: "Local User" };
  }
}

export function createAuthProvider(authMode: string): AuthProvider {
  if (authMode === "none") return new NoAuthProvider();
  throw configError("Unsupported AUTH_MODE.", { authMode });
}

