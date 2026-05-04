import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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

  test("ignores filesystem noise outside managed graph record files", () => {
    const graphPath = tempGraphPath();
    try {
      const repository = new JsonGraphRepository(graphPath);
      repository.createNodeType({ name: "Person" });
      const before = fingerprintGraphPath(graphPath);

      mkdirSync(path.join(graphPath, ".cache"), { recursive: true });
      writeFileSync(path.join(graphPath, ".cache", "noise.json"), "{}", "utf8");
      writeFileSync(path.join(graphPath, "notes.json"), "{}", "utf8");
      writeFileSync(path.join(graphPath, "node-types", ".person.json.tmp"), "{}", "utf8");
      writeFileSync(path.join(graphPath, "node-types", "person.json.tmp"), "{}", "utf8");
      writeFileSync(path.join(graphPath, "node-types", "person.json.swp"), "{}", "utf8");
      writeFileSync(path.join(graphPath, "node-types", "person.json~"), "{}", "utf8");

      expect(fingerprintGraphPath(graphPath)).toBe(before);
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
      const monitor = startGraphMonitor({ graphPath, realtime, watchDebounceMs: 1000 });
      const repository = new JsonGraphRepository(graphPath);
      repository.createNodeType({ name: "Person" });

      monitor?.checkNow();

      expect(events).toEqual([{ type: "graph.changed", recordType: "graph", recordId: "graph", operation: "external-change" }]);
      monitor?.stop();
    } finally {
      cleanup(graphPath);
    }
  });

  test("broadcasts from filesystem watch when another process changes graph content", async () => {
    const graphPath = tempGraphPath();
    const realtime = new RealtimeHub();
    const events: unknown[] = [];
    let resolveChange: (() => void) | undefined;
    const changePromise = new Promise<void>((resolve, reject) => {
      resolveChange = resolve;
      setTimeout(() => reject(new Error("Timed out waiting for graph watch event.")), 1000);
    });
    realtime.broadcast = event => {
      events.push(event);
      resolveChange?.();
    };

    try {
      const repository = new JsonGraphRepository(graphPath);
      const monitor = startGraphMonitor({ graphPath, realtime, watchDebounceMs: 10 });
      repository.createNodeType({ name: "Project" });

      await changePromise;

      expect(events).toEqual([{ type: "graph.changed", recordType: "graph", recordId: "graph", operation: "external-change" }]);
      monitor?.stop();
    } finally {
      cleanup(graphPath);
    }
  });
});
