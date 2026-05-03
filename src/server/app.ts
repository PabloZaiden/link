import { serve, type BunFile, type HTMLBundle, type Server } from "bun";
import { createRoutes } from "../api/http";
import { RealtimeHub } from "../realtime/hub";
import { JsonGraphRepository } from "../storage/json";
import type { GraphRepository } from "../storage/repository";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";

export interface AppDependencies {
  config?: AppConfig;
  repository?: GraphRepository;
  realtime?: RealtimeHub;
  index: Response | BunFile | HTMLBundle;
}

export function createApp(dependencies: AppDependencies) {
  const config = dependencies.config ?? loadConfig();
  const repository = dependencies.repository ?? new JsonGraphRepository(config.graphPath);
  const realtime = dependencies.realtime ?? new RealtimeHub();

  return {
    port: config.port,
    routes: createRoutes({ repository, realtime, config, index: dependencies.index }),
    websocket: realtime.websocket,
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  };
}

export function startApp(index: Response | BunFile | HTMLBundle): Server<undefined> {
  const app = createApp({ index });
  const server = serve(app);
  console.log(`Link server running at ${server.url}`);
  return server;
}
