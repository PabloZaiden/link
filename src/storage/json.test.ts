import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { GraphError } from "../domain/errors";
import { JsonGraphRepository, validateGraphPath } from "./json";

function tempGraphPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "link-json-")), "graph");
}

function cleanup(graphPath: string): void {
  rmSync(path.dirname(graphPath), { recursive: true, force: true });
}

describe("JsonGraphRepository", () => {
  test("creates directories, seeds bootstrap types, and writes canonical JSON", () => {
    const graphPath = tempGraphPath();
    try {
      const storage = new JsonGraphRepository(graphPath);
      const snapshot = storage.getSnapshot();
      expect(snapshot.nodeTypes.some(type => type.id === "person")).toBe(true);
      expect(snapshot.edgeTypes.some(type => type.id === "works-on")).toBe(true);
      const personPath = path.join(graphPath, "node-types", "person.json");
      expect(existsSync(personPath)).toBe(true);
      expect(readFileSync(personPath, "utf8")).toEndWith("\n");
    } finally {
      cleanup(graphPath);
    }
  });

  test("persists create, update, delete, search, and context operations", () => {
    const graphPath = tempGraphPath();
    try {
      const storage = new JsonGraphRepository(graphPath);
      const ada = storage.createNode({ name: "Ada Lovelace", typeId: "person" });
      const link = storage.createNode({ name: "Link", typeId: "project" });
      const edge = storage.createEdge({
        typeId: "works-on",
        sourceNodeId: ada.record.id,
        targetNodeId: link.record.id,
        direction: "directed",
      });
      storage.updateNode(ada.record.id, { metadata: { role: "Computing pioneer" } });

      const restarted = new JsonGraphRepository(graphPath);
      expect(restarted.search("pioneer").nodes[0]?.id).toBe(ada.record.id);
      expect(restarted.getContext(ada.record.id).edges[0]?.id).toBe(edge.record.id);

      restarted.deleteNode(link.record.id);
      expect(restarted.getSnapshot().nodes.some(node => node.id === link.record.id)).toBe(false);
      expect(restarted.getSnapshot().edges.some(candidate => candidate.id === edge.record.id)).toBe(false);
    } finally {
      cleanup(graphPath);
    }
  });

  test("ignores dotfiles and temporary files in collection directories", () => {
    const graphPath = tempGraphPath();
    try {
      const storage = new JsonGraphRepository(graphPath);
      writeFileSync(path.join(graphPath, "nodes", ".DS_Store"), "metadata");
      writeFileSync(path.join(graphPath, "nodes", "person.json.123.tmp"), "{\"partial\":true}");
      writeFileSync(path.join(graphPath, "nodes", "Thumbs.db"), "metadata");

      expect(() => validateGraphPath(graphPath)).not.toThrow();
      expect(storage.getSnapshot().nodeTypes.some(type => type.id === "person")).toBe(true);
    } finally {
      cleanup(graphPath);
    }
  });

  test("refuses deleting types that are still in use", () => {
    const graphPath = tempGraphPath();
    try {
      const storage = new JsonGraphRepository(graphPath);
      storage.createNode({ name: "Ada Lovelace", typeId: "person" });
      expect(() => storage.deleteNodeType("person")).toThrow(GraphError);
    } finally {
      cleanup(graphPath);
    }
  });

  test("fails loudly for file/id mismatches, missing references, and merge conflicts", () => {
    const graphPath = tempGraphPath();
    try {
      const storage = new JsonGraphRepository(graphPath);
      storage.createNode({ id: "ada", name: "Ada", typeId: "person" });

      writeFileSync(
        path.join(graphPath, "nodes", "wrong-file.json"),
        JSON.stringify({ id: "right-id", name: "Right", typeId: "person", description: "", metadata: {}, createdAt: "2026-05-03T00:00:00.000Z", updatedAt: "2026-05-03T00:00:00.000Z" }),
      );
      expect(() => validateGraphPath(graphPath)).toThrow(GraphError);
      rmSync(path.join(graphPath, "nodes", "wrong-file.json"));

      writeFileSync(
        path.join(graphPath, "edges", "bad-edge.json"),
        JSON.stringify({
          id: "bad-edge",
          typeId: "works-on",
          sourceNodeId: "ada",
          targetNodeId: "missing",
          direction: "directed",
          description: "",
          metadata: {},
          createdAt: "2026-05-03T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        }),
      );
      expect(() => validateGraphPath(graphPath)).toThrow(GraphError);
      rmSync(path.join(graphPath, "edges", "bad-edge.json"));

      writeFileSync(path.join(graphPath, "nodes", "conflict.json"), "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>>\n");
      expect(() => validateGraphPath(graphPath)).toThrow(GraphError);
    } finally {
      cleanup(graphPath);
    }
  });
});
