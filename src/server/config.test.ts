import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { GraphError } from "../domain/errors";

describe("loadConfig", () => {
  test("loads defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.authMode).toBe("none");
    expect(config.databaseProvider).toBe("sqlite");
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
    expect(() => loadConfig({ AUTH_MODE: "entra" })).toThrow(GraphError);
    expect(() => loadConfig({ DATABASE_PROVIDER: "sql" })).toThrow(GraphError);
  });
});

