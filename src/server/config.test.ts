import { describe, expect, test } from "bun:test";
import path from "path";
import { loadConfig } from "./config";
import { GraphError } from "../domain/errors";

describe("loadConfig", () => {
  test("loads defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.graphPollIntervalMs).toBe(2000);
    expect(path.normalize(config.graphPath).endsWith(path.join(".data", "graph"))).toBe(true);
  });

  test("uses LINK_PORT when provided", () => {
    const config = loadConfig({ LINK_PORT: "4123" });
    expect(config.port).toBe(4123);
  });

  test("prefers LINK_PORT over PORT", () => {
    const config = loadConfig({ LINK_PORT: "4123", PORT: "3001" });
    expect(config.port).toBe(4123);
  });

  test("rejects invalid values", () => {
    expect(() => loadConfig({ PORT: "bad" })).toThrow(GraphError);
    expect(() => loadConfig({ LINK_PORT: "bad" })).toThrow(GraphError);
    expect(() => loadConfig({ LINK_GRAPH_POLL_INTERVAL_MS: "bad" })).toThrow(GraphError);
  });

  test("uses LINK_DATA_DIR for the graph root", () => {
    expect(loadConfig({ LINK_DATA_DIR: "/tmp/link-data" }).graphPath).toBe(path.join("/tmp/link-data", "graph"));
  });

  test("uses LINK_GRAPH_POLL_INTERVAL_MS for the graph monitor", () => {
    expect(loadConfig({ LINK_GRAPH_POLL_INTERVAL_MS: "0" }).graphPollIntervalMs).toBe(0);
    expect(loadConfig({ LINK_GRAPH_POLL_INTERVAL_MS: "5000" }).graphPollIntervalMs).toBe(5000);
  });
});
