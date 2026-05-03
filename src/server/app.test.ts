import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import index from "../index.html";
import { createApp } from "./app";

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
});
