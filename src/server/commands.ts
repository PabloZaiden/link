import { GraphError } from "../domain/errors";
import { callGraphTool } from "../graph/tools";
import { JsonGraphRepository, validateGraphPath } from "../storage/json";
import { loadConfig } from "./config";
import {
  formatGraphActionHelp,
  formatGraphHelp,
  formatTopLevelHelp,
  type CliCommand,
} from "./cli";

const noopRealtime = {
  broadcast: () => {},
};

function printGraphError(error: GraphError): void {
  console.error(error.message);
  if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2));
}

export function runCliCommand(command: CliCommand): number | undefined {
  try {
    switch (command.kind) {
      case "help":
        console.log(formatTopLevelHelp());
        return 0;
      case "web":
        return undefined;
      case "validate":
        return runValidateCommand();
      case "seed":
        return runSeedCommand();
      case "graph-help":
        console.log(formatGraphHelp());
        return 0;
      case "graph-action-help":
        console.log(formatGraphActionHelp(command.action));
        return 0;
      case "graph-action":
        return runGraphActionCommand(command);
    }
  } catch (error) {
    if (error instanceof GraphError) {
      printGraphError(error);
      return 1;
    }
    console.error(error);
    return 1;
  }
}

export function runValidateCommand(): number {
  const config = loadConfig();
  validateGraphPath(config.graphPath);
  console.log(`Graph data is valid: ${config.graphPath}`);
  return 0;
}

export function runSeedCommand(): number {
  const config = loadConfig();
  const repository = new JsonGraphRepository(config.graphPath, { seed: true });
  try {
    repository.getSnapshot();
    console.log(`Graph seed checked: ${config.graphPath}`);
    return 0;
  } finally {
    repository.close();
  }
}

function runGraphActionCommand(command: Extract<CliCommand, { kind: "graph-action" }>): number {
  const config = loadConfig();
  const repository = new JsonGraphRepository(config.graphPath);
  try {
    const result = callGraphTool(command.action, command.args, {
      repository,
      realtime: noopRealtime,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } finally {
    repository.close();
  }
}
