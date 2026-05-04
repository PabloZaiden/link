import { describe, expect, test } from "bun:test";
import { GraphError } from "../domain/errors";
import { graphToolNames } from "../graph/tools";
import { LINK_VERSION } from "../version";
import { formatGraphActionHelp, formatGraphHelp, formatTopLevelHelp, parseCliCommand, parseGraphActionArgs } from "./cli";

describe("parseCliCommand", () => {
  test("defaults to top-level help", () => {
    expect(parseCliCommand(["bun", "src/index.ts"])).toEqual({ kind: "help" });
  });

  test("parses top-level actions", () => {
    expect(parseCliCommand(["bun", "src/index.ts", "web"])).toEqual({ kind: "web" });
    expect(parseCliCommand(["bun", "src/index.ts", "validate"])).toEqual({ kind: "validate" });
    expect(parseCliCommand(["bun", "src/index.ts", "seed"])).toEqual({ kind: "seed" });
    expect(parseCliCommand(["bun", "src/index.ts", "update"])).toEqual({ kind: "update", checkOnly: false, version: undefined });
  });

  test("parses update options", () => {
    expect(parseCliCommand(["bun", "src/index.ts", "update", "--check"])).toEqual({
      kind: "update",
      checkOnly: true,
      version: undefined,
    });
    expect(parseCliCommand(["bun", "src/index.ts", "update", "--version", "v1.2.3"])).toEqual({
      kind: "update",
      checkOnly: false,
      version: "v1.2.3",
    });
    expect(parseCliCommand(["bun", "src/index.ts", "update", "--version=1.2.3"])).toEqual({
      kind: "update",
      checkOnly: false,
      version: "1.2.3",
    });
  });

  test("rejects invalid update options", () => {
    expect(() => parseCliCommand(["bun", "src/index.ts", "update", "extra"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "update", "--missing"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "update", "--version"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "update", "--check", "--version", "1.2.3"])).toThrow(GraphError);
  });

  test("rejects legacy flags and web seed", () => {
    expect(() => parseCliCommand(["bun", "src/index.ts", "--validate"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "--seed"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "web", "--seed"])).toThrow(GraphError);
  });

  test("parses graph help and action help", () => {
    expect(parseCliCommand(["bun", "src/index.ts", "graph"])).toEqual({ kind: "graph-help" });
    expect(parseCliCommand(["bun", "src/index.ts", "graph", "create_node", "--help"])).toEqual({
      kind: "graph-action-help",
      action: "create_node",
    });
  });

  test("parses graph action input", () => {
    expect(parseCliCommand([
      "bun",
      "src/index.ts",
      "graph",
      "create_node",
      "--json",
      '{"name":"Ada","metadata":{"role":"engineer"}}',
      "--typeId",
      "person",
    ])).toEqual({
      kind: "graph-action",
      action: "create_node",
      args: { name: "Ada", metadata: { role: "engineer" }, typeId: "person" },
    });
  });

  test("rejects unknown graph actions", () => {
    expect(() => parseCliCommand(["bun", "src/index.ts", "graph", "missing"])).toThrow(GraphError);
  });

  test("rejects graph flags that are not supported by the selected action", () => {
    expect(() => parseCliCommand(["bun", "src/index.ts", "graph", "delete_node", "--query", "ada"])).toThrow(GraphError);
    expect(() => parseCliCommand(["bun", "src/index.ts", "graph", "search_graph", "--nodeId", "ada"])).toThrow(GraphError);
  });
});

describe("parseGraphActionArgs", () => {
  test("parses booleans and JSON object fields", () => {
    expect(parseGraphActionArgs(["--immutable", "--metadataSchema", '{"required":["team"]}'])).toEqual({
      immutable: true,
      metadataSchema: { required: ["team"] },
    });
    expect(parseGraphActionArgs(["--immutable=false"])).toEqual({ immutable: false });
  });
});

describe("graph help", () => {
  test("top-level help prints the CLI version and update command", () => {
    const help = formatTopLevelHelp();
    expect(help).toStartWith(`link-cli ${LINK_VERSION}`);
    expect(help).toContain("update");
  });

  test("lists graph actions from the shared registry", () => {
    const help = formatGraphHelp();
    for (const name of graphToolNames) {
      expect(help).toContain(name);
    }
  });

  test("shows action-specific help from the shared registry", () => {
    const help = formatGraphActionHelp("create_node");
    expect(help).toContain("Create Node");
    expect(help).toContain("--json <json-object>");
    expect(help).toContain("--typeId <value>");
  });
});
