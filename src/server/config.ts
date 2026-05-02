import path from "path";
import { configError } from "../domain/errors";

export interface AppConfig {
  port: number;
  authMode: "none";
  databaseProvider: "sqlite";
  sqlitePath: string;
  adminEnabled: boolean;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw configError("Boolean config value must be true/false or 1/0.", { value });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portText = env.LINK_PORT ?? env.PORT ?? "3000";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("LINK_PORT or PORT must be an integer between 1 and 65535.", { port: portText });
  }

  const authMode = env.AUTH_MODE ?? "none";
  if (authMode !== "none") throw configError("Only AUTH_MODE=none is supported in this implementation.", { authMode });

  const databaseProvider = env.DATABASE_PROVIDER ?? "sqlite";
  if (databaseProvider !== "sqlite") {
    throw configError("Only DATABASE_PROVIDER=sqlite is supported in this implementation.", { databaseProvider });
  }

  const sqlitePath =
    env.SQLITE_PATH ??
    (env.NODE_ENV === "production" ? "/data/link.sqlite" : path.join(process.cwd(), ".data", "link.sqlite"));

  return {
    port,
    authMode,
    databaseProvider,
    sqlitePath,
    adminEnabled: readBoolean(env.ADMIN_ENABLED, env.NODE_ENV !== "production"),
  };
}

