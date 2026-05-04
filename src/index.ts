import index from "./index.html";
import { GraphError } from "./domain/errors";
import { runCliCommand } from "./server/commands";
import { startApp } from "./server/app";
import { parseCliCommand } from "./server/cli";

let command;

try {
  command = parseCliCommand(Bun.argv);
} catch (error) {
  if (error instanceof GraphError) {
    console.error(error.message);
    if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2));
  } else {
    console.error(error);
  }
  process.exit(1);
}

if (command.kind === "web") {
  startApp(index);
} else {
  const exitCode = await runCliCommand(command);
  process.exit(exitCode ?? 0);
}
