import path from "path";
import { configError } from "../domain/errors";

export interface AppConfig {
  port: number;
  graphPath: string;
  graphWatchDebounceMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portText = env.LINK_PORT ?? env.PORT ?? "3000";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("LINK_PORT or PORT must be an integer between 1 and 65535.", { port: portText });
  }

  const graphWatchDebounceText = env.LINK_GRAPH_WATCH_DEBOUNCE_MS ?? "50";
  const graphWatchDebounceMs = Number(graphWatchDebounceText);
  if (!Number.isInteger(graphWatchDebounceMs) || graphWatchDebounceMs < 0) {
    throw configError("LINK_GRAPH_WATCH_DEBOUNCE_MS must be a non-negative integer.", { graphWatchDebounceMs: graphWatchDebounceText });
  }

  const dataDir = env.LINK_DATA_DIR ?? path.join(process.cwd(), ".data");

  return {
    port,
    graphPath: path.join(dataDir, "graph"),
    graphWatchDebounceMs,
  };
}
