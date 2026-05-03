import path from "path";
import { configError } from "../domain/errors";

export interface AppConfig {
  port: number;
  graphPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portText = env.LINK_PORT ?? env.PORT ?? "3000";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("LINK_PORT or PORT must be an integer between 1 and 65535.", { port: portText });
  }

  return {
    port,
    graphPath: env.LINK_GRAPH_PATH ?? env.GRAPH_PATH ?? path.join(process.cwd(), "data", "graph"),
  };
}
