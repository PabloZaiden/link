import { GraphError } from "../domain/errors";
import { graphTools, isGraphToolName, type GraphToolName, type JsonMap } from "../graph/tools";

export type CliCommand =
  | { kind: "help" }
  | { kind: "web" }
  | { kind: "validate" }
  | { kind: "seed" }
  | { kind: "graph-help" }
  | { kind: "graph-action-help"; action: GraphToolName }
  | { kind: "graph-action"; action: GraphToolName; args: JsonMap };

const scalarFields = new Set([
  "id",
  "name",
  "description",
  "typeId",
  "nodeId",
  "sourceNodeId",
  "targetNodeId",
  "direction",
  "query",
]);
const booleanFields = new Set(["immutable", "includeTypes"]);
const jsonFields = new Set(["metadata", "metadataSchema"]);
const allGraphFields = new Set([...scalarFields, ...booleanFields, ...jsonFields]);

function usageError(message: string, details?: unknown): never {
  throw new GraphError("VALIDATION", message, details);
}

function cliArgs(argv: string[]): string[] {
  return argv.slice(2);
}

function parseJsonObject(text: string, label: string): JsonMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) usageError(`${label} must be valid JSON.`);
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    usageError(`${label} must be a JSON object.`);
  }
  return parsed as JsonMap;
}

function parseBoolean(text: string | undefined): boolean {
  if (text === undefined) return true;
  if (text === "true") return true;
  if (text === "false") return false;
  usageError("Boolean flags must be true or false.", { value: text });
}

function readFlagValue(args: string[], index: number, field: string): { value: string | undefined; nextIndex: number } {
  const next = args[index + 1];
  if (booleanFields.has(field) && (next === undefined || next.startsWith("--"))) {
    return { value: undefined, nextIndex: index };
  }
  if (next === undefined || next.startsWith("--")) {
    usageError(`--${field} requires a value.`);
  }
  return { value: next, nextIndex: index + 1 };
}

export function parseGraphActionArgs(args: string[]): JsonMap {
  const parsed: JsonMap = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) usageError(`Unexpected positional argument "${arg}".`);

    const withoutPrefix = arg.slice(2);
    const [field, inlineValue] = withoutPrefix.includes("=")
      ? (withoutPrefix.split(/=(.*)/s, 2) as [string, string])
      : [withoutPrefix, undefined];

    if (field === "help" || field === "h") usageError("--help is only valid immediately after a graph action.");

    if (field === "json") {
      const value = inlineValue ?? readFlagValue(args, i, field).value;
      if (inlineValue === undefined) i = readFlagValue(args, i, field).nextIndex;
      Object.assign(parsed, parseJsonObject(value ?? "", "--json"));
      continue;
    }

    if (!allGraphFields.has(field)) usageError(`Unknown graph argument --${field}.`, { field });

    const { value, nextIndex } = inlineValue === undefined ? readFlagValue(args, i, field) : { value: inlineValue, nextIndex: i };
    i = nextIndex;

    if (booleanFields.has(field)) {
      parsed[field] = parseBoolean(value);
    } else if (jsonFields.has(field)) {
      parsed[field] = parseJsonObject(value ?? "", `--${field}`);
    } else {
      parsed[field] = value;
    }
  }

  return parsed;
}

export function parseCliCommand(argv: string[]): CliCommand {
  const args = cliArgs(argv);
  const [command, ...rest] = args;

  if (command === undefined || command === "--help" || command === "-h") return { kind: "help" };

  if (command === "web") {
    if (rest.length > 0) usageError("web does not accept arguments.");
    return { kind: "web" };
  }

  if (command === "validate") {
    if (rest.length > 0) usageError("validate does not accept arguments.");
    return { kind: "validate" };
  }

  if (command === "seed") {
    if (rest.length > 0) usageError("seed does not accept arguments.");
    return { kind: "seed" };
  }

  if (command === "graph") {
    const [action, ...actionArgs] = rest;
    if (action === undefined || action === "--help" || action === "-h") return { kind: "graph-help" };
    if (!isGraphToolName(action)) usageError("Unknown graph action.", { action });
    if (actionArgs.length === 1 && (actionArgs[0] === "--help" || actionArgs[0] === "-h")) {
      return { kind: "graph-action-help", action };
    }
    return { kind: "graph-action", action, args: parseGraphActionArgs(actionArgs) };
  }

  usageError("Unknown command.", { command });
}

export function formatTopLevelHelp(binaryName = "link-cli"): string {
  return [
    "Usage:",
    `  ${binaryName} <command>`,
    "",
    "Commands:",
    "  web       Start the web UI, HTTP API, realtime endpoint, and MCP endpoint.",
    "  validate  Validate graph JSON files.",
    "  seed      Create default graph types when the graph is empty.",
    "  graph     Run graph actions directly from the CLI.",
    "",
    `Run "${binaryName} graph" to list graph actions.`,
  ].join("\n");
}

export function formatGraphHelp(binaryName = "link-cli"): string {
  return [
    "Usage:",
    `  ${binaryName} graph <action> [options]`,
    "",
    "Actions:",
    ...graphTools.map(tool => `  ${tool.name.padEnd(17)} ${tool.description}`),
    "",
    `Run "${binaryName} graph <action> --help" for action-specific help.`,
  ].join("\n");
}

export function formatGraphActionHelp(action: GraphToolName, binaryName = "link-cli"): string {
  const tool = graphTools.find(candidate => candidate.name === action)!;
  const fieldLines = tool.cliFields.length === 0
    ? ["  (no fields)"]
    : tool.cliFields.map(field => {
        if (jsonFields.has(field)) return `  --${field} <json-object>`;
        if (booleanFields.has(field)) return `  --${field}[=true|false]`;
        return `  --${field} <value>`;
      });

  return [
    `${tool.title} (${tool.name})`,
    "",
    tool.description,
    "",
    "Usage:",
    `  ${binaryName} graph ${tool.name} [options]`,
    "",
    "Options:",
    "  --json <json-object>  Full MCP-compatible input object.",
    ...fieldLines,
    "",
    "Examples:",
    ...tool.examples.map(example => `  ${example}`),
  ].join("\n");
}
