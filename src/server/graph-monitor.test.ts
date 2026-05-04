import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { RealtimeHub } from "../realtime/hub";
import { JsonGraphRepository } from "../storage/json";
import { fingerprintGraphPath, startGraphMonitor } from "./graph-monitor";

function tempGraphPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "link-monitor-")), "graph");
}

function cleanup(graphPath: string): void {
  rmSync(path.dirname(graphPath), { recursive: true, force: true });
}

describe("fingerprintGraphPath", () => {
  test("changes when graph content changes", () => {
    const graphPath = tempGraphPath();
    try {
      const before = fingerprintGraphPath(graphPath);
      const repository = new JsonGraphRepository(graphPath);
      repository.createNodeType({ name: "Person" });
      const after = fingerprintGraphPath(graphPath);
      expect(after).not.toBe(before);
    } finally {
      cleanup(graphPath);
    }
  });
});

describe("startGraphMonitor", () => {
  test("broadcasts when another process changes graph content", () => {
    const graphPath = tempGraphPath();
    const realtime = new RealtimeHub();
    const events: unknown[] = [];
    realtime.broadcast = event => {
      events.push(event);
    };

    try {
      const monitor = startGraphMonitor({ graphPath, realtime, intervalMs: 1000 });
      const repository = new JsonGraphRepository(graphPath);
      repository.createNodeType({ name: "Person" });

      monitor?.checkNow();

      expect(events).toEqual([{ type: "graph.changed", recordType: "graph", recordId: "graph", operation: "external-change" }]);
      monitor?.stop();
    } finally {
      cleanup(graphPath);
    }
  });
});
