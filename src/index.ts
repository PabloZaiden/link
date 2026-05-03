import index from "./index.html";
import { GraphError } from "./domain/errors";
import { startApp } from "./server/app";
import { parseCliOptions } from "./server/cli";
import { loadConfig } from "./server/config";
import { validateGraphPath } from "./storage/json";

const cliOptions = parseCliOptions(Bun.argv);

if (cliOptions.validate) {
  const config = loadConfig();
  try {
    validateGraphPath(config.graphPath);
    console.log(`Graph data is valid: ${config.graphPath}`);
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
  startApp(index, { seed: cliOptions.seed });
}
