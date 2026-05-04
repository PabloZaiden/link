import { describe, expect, test } from "bun:test";
import path from "path";
import { loadConfig } from "./config";
import { GraphError } from "../domain/errors";

describe("loadConfig", () => {
  test("loads defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.graphWatchDebounceMs).toBe(50);
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
    expect(() => loadConfig({ LINK_GRAPH_WATCH_DEBOUNCE_MS: "bad" })).toThrow(GraphError);
  });

  test("uses LINK_DATA_DIR for the graph root", () => {
    expect(loadConfig({ LINK_DATA_DIR: "/tmp/link-data" }).graphPath).toBe(path.join("/tmp/link-data", "graph"));
  });

  test("uses LINK_GRAPH_WATCH_DEBOUNCE_MS for the graph monitor", () => {
    expect(loadConfig({ LINK_GRAPH_WATCH_DEBOUNCE_MS: "0" }).graphWatchDebounceMs).toBe(0);
    expect(loadConfig({ LINK_GRAPH_WATCH_DEBOUNCE_MS: "5000" }).graphWatchDebounceMs).toBe(5000);
  });
});
