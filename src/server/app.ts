import { serve, type BunFile, type HTMLBundle, type Server } from "bun";
import { createRoutes } from "../api/http";
import { configError } from "../domain/errors";
import { RealtimeHub } from "../realtime/hub";
import { JsonGraphRepository } from "../storage/json";
import type { GraphRepository } from "../storage/repository";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";

export interface AppDependencies {
  config?: AppConfig;
  repository?: GraphRepository;
  realtime?: RealtimeHub;
  seed?: boolean;
  index: Response | BunFile | HTMLBundle;
}

export function createApp(dependencies: AppDependencies) {
  const config = dependencies.config ?? loadConfig();
  if (dependencies.repository !== undefined && dependencies.seed === true) {
    throw configError("Cannot seed during app creation when a custom repository is provided. Seed the repository before passing it to createApp().");
  }
  const repository = dependencies.repository ?? new JsonGraphRepository(config.graphPath, { seed: dependencies.seed ?? false });
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

export interface StartAppOptions {
  config?: AppConfig;
  seed?: boolean;
}

export function startApp(index: Response | BunFile | HTMLBundle, options: StartAppOptions = {}): Server<undefined> {
  const app = createApp({ index, config: options.config, seed: options.seed ?? false });
  const server = serve(app);
  console.log(`Link server running at ${server.url}`);
  return server;
}
