import { describe, expect, test } from "bun:test";
import { SqliteGraphRepository } from "./sqlite";
import { GraphError } from "../domain/errors";
import type { Actor } from "../domain/types";

const actor: Actor = { id: "test", displayName: "Test User" };

function repo() {
  return new SqliteGraphRepository(":memory:");
}

describe("SqliteGraphRepository", () => {
  test("seeds bootstrap types and persists current graph version", () => {
    const storage = repo();
    const snapshot = storage.seedBootstrap(actor);
    expect(snapshot.version).toBe(1);
    expect(snapshot.nodeTypes.some(type => type.id === "person")).toBe(true);
    expect(snapshot.edgeTypes.some(type => type.id === "member-of")).toBe(true);
    storage.close();
  });

  test("creates nodes and edges with optimistic concurrency", () => {
    const storage = repo();
    storage.seedBootstrap(actor);
    const first = storage.createNode({ name: "Ada Lovelace", typeId: "person" }, { expectedVersion: 1, actor });
    const second = storage.createNode({ name: "Link", typeId: "project" }, { expectedVersion: first.version, actor });
    const edge = storage.createEdge(
      {
        typeId: "works-on",
        sourceNodeId: first.record.id,
        targetNodeId: second.record.id,
        direction: "directed",
      },
      { expectedVersion: second.version, actor },
    );

    expect(storage.getContext(first.record.id).edges[0]?.id).toBe(edge.record.id);
    expect(() => storage.createNode({ name: "Stale", typeId: "person" }, { expectedVersion: 1, actor })).toThrow(GraphError);
    storage.close();
  });

  test("tombstoned node usage does not block type deletion", () => {
    const storage = repo();
    storage.seedBootstrap(actor);
    const node = storage.createNode({ name: "Temporary", typeId: "other" }, { expectedVersion: 1, actor });
    const deleted = storage.deleteNode(node.record.id, { expectedVersion: node.version, actor });
    const typeDelete = storage.deleteNodeType("other", { expectedVersion: deleted.version, actor });
    expect(typeDelete.deletedId).toBe("other");
    storage.close();
  });

  test("exports and imports graph data", () => {
    const source = repo();
    source.seedBootstrap(actor);
    const node = source.createNode({ name: "Exported", typeId: "project" }, { expectedVersion: 1, actor });
    const exported = source.exportGraph();

    const target = repo();
    const imported = target.importGraph(exported, actor);
    expect(imported.nodes.some(candidate => candidate.id === node.record.id)).toBe(true);
    expect(target.getHistory()[0]?.operation).toBe("import");
    source.close();
    target.close();
  });

  test("rejects malformed import payload arrays before modifying storage", () => {
    const source = repo();
    source.seedBootstrap(actor);
    const exported = source.exportGraph();

    const target = repo();
    target.seedBootstrap(actor);
    const beforeVersion = target.getSnapshot().version;
    const malformed = {
      ...exported,
      nodes: {},
      tombstones: { nodeTypes: [], edgeTypes: [], nodes: [], edges: [] },
    };

    expect(() => target.importGraph(malformed as unknown as typeof exported, actor)).toThrow(GraphError);
    expect(target.getSnapshot().version).toBe(beforeVersion);
    source.close();
    target.close();
  });

  test("records node delete history with aligned before and after snapshots", () => {
    const storage = repo();
    storage.seedBootstrap(actor);
    const node = storage.createNode({ name: "History node", typeId: "person" }, { expectedVersion: 1, actor });
    const deleted = storage.deleteNode(node.record.id, { expectedVersion: node.version, actor });
    const change = storage.getHistoryVersion(deleted.version);

    expect(change?.before).toMatchObject({ node: { id: node.record.id, deletedAt: null }, connectedEdges: [] });
    expect(change?.after).toMatchObject({ node: { id: node.record.id }, connectedEdges: [] });
    const afterNode = (change?.after as { node?: { deletedAt?: string | null; updatedAt?: string } }).node;
    expect(afterNode?.deletedAt).toBeString();
    expect(afterNode?.updatedAt).toBe(afterNode?.deletedAt ?? undefined);
    storage.close();
  });
});
