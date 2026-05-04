import path from "path";
import { configError } from "../domain/errors";

export interface AppConfig {
  port: number;
  graphPath: string;
  graphPollIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portText = env.LINK_PORT ?? env.PORT ?? "3000";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("LINK_PORT or PORT must be an integer between 1 and 65535.", { port: portText });
  }

  const graphPollIntervalText = env.LINK_GRAPH_POLL_INTERVAL_MS ?? "2000";
  const graphPollIntervalMs = Number(graphPollIntervalText);
  if (!Number.isInteger(graphPollIntervalMs) || graphPollIntervalMs < 0) {
    throw configError("LINK_GRAPH_POLL_INTERVAL_MS must be a non-negative integer.", { graphPollIntervalMs: graphPollIntervalText });
  }

  const dataDir = env.LINK_DATA_DIR ?? path.join(process.cwd(), ".data");

  return {
    port,
    graphPath: path.join(dataDir, "graph"),
    graphPollIntervalMs,
  };
}
