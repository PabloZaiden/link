import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import index from "../index.html";
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
      createApp({ index, config: { port: 0, graphPath, graphPollIntervalMs: 0 } });
      expect(existsSync(graphPath)).toBe(false);
    } finally {
      cleanup(graphPath);
    }
  });

});

describe("startApp", () => {
  test("starts the app without seeding graph data", () => {
    const graphPath = tempGraphPath();
    const server = startApp(index, { config: { port: 0, graphPath, graphPollIntervalMs: 0 } });
    try {
      expect(existsSync(graphPath)).toBe(false);
    } finally {
      server.stop(true);
      cleanup(graphPath);
    }
  });
});
