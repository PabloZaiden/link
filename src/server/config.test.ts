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

  test("rejects invalid values", () => {
    expect(() => loadConfig({ PORT: "bad" })).toThrow(GraphError);
    expect(() => loadConfig({ AUTH_MODE: "entra" })).toThrow(GraphError);
    expect(() => loadConfig({ DATABASE_PROVIDER: "sql" })).toThrow(GraphError);
  });
});

