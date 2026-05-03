import index from "./index.html";
import { GraphError } from "./domain/errors";
import { startApp } from "./server/app";
import { loadConfig } from "./server/config";
import { validateGraphPath } from "./storage/json";

function argValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  if (index === -1) return undefined;
  return Bun.argv[index + 1];
}

if (Bun.argv.includes("--validate")) {
  const config = loadConfig();
  const graphPath = argValue("--graph-path") ?? config.graphPath;
  try {
    validateGraphPath(graphPath);
    console.log(`Graph data is valid: ${graphPath}`);
    process.exit(0);
  } catch (error) {
    if (error instanceof GraphError) {
      console.error(error.message);
      if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2));
    } else {
      console.error(error);
    }
    process.exit(1);
  }
} else {
  startApp(index);
}
