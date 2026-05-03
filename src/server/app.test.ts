import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import index from "../index.html";
import { GraphError } from "../domain/errors";
import { JsonGraphRepository } from "../storage/json";
import { createApp, startApp } from "./app";

function tempGraphPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "link-app-")), "graph");
}

function cleanup(graphPath: string): void {
  rmSync(path.dirname(graphPath), { recursive: true, force: true });
}

describe("createApp", () => {
  test("does not create graph directories during normal startup", () => {
    const graphPath = tempGraphPath();
    try {
      createApp({ index, config: { port: 0, graphPath } });
      expect(existsSync(graphPath)).toBe(false);
    } finally {
      cleanup(graphPath);
    }
  });

  test("passes explicit seed startup through to repository creation", () => {
    const graphPath = tempGraphPath();
    try {
      createApp({ index, config: { port: 0, graphPath }, seed: true });
      expect(existsSync(path.join(graphPath, "node-types", "person.json"))).toBe(true);
      expect(existsSync(path.join(graphPath, "edge-types", "works-on.json"))).toBe(true);
    } finally {
      cleanup(graphPath);
    }
  });

  test("rejects seed with a custom repository because the option cannot be applied", () => {
    const graphPath = tempGraphPath();
    try {
      const repository = new JsonGraphRepository(graphPath);
      expect(() => createApp({ index, config: { port: 0, graphPath }, repository, seed: true })).toThrow(GraphError);
      expect(existsSync(graphPath)).toBe(false);
    } finally {
      cleanup(graphPath);
    }
  });
});

describe("startApp", () => {
  test("forwards explicit seed startup through to app and repository creation", () => {
    const graphPath = tempGraphPath();
    const server = startApp(index, { config: { port: 0, graphPath }, seed: true });
    try {
      expect(existsSync(path.join(graphPath, "node-types", "person.json"))).toBe(true);
      expect(existsSync(path.join(graphPath, "edge-types", "works-on.json"))).toBe(true);
    } finally {
      server.stop(true);
      cleanup(graphPath);
    }
  });
});
