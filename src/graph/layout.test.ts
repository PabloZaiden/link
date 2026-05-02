import { describe, expect, test } from "bun:test";
import { layoutGraph, type LayoutEdge, type LayoutNode } from "./layout";

function nodes(count: number): LayoutNode[] {
  return Array.from({ length: count }, (_, index) => ({ id: `node-${index}` }));
}

function chainEdges(count: number): LayoutEdge[] {
  return Array.from({ length: count - 1 }, (_, index) => ({ sourceNodeId: `node-${index}`, targetNodeId: `node-${index + 1}` }));
}

function minimumDistance(layout: ReturnType<typeof layoutGraph>): number {
  const positions = [...layout.positions.values()];
  let minimum = Number.POSITIVE_INFINITY;

  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const leftPosition = positions[left];
      const rightPosition = positions[right];
      if (!leftPosition || !rightPosition) continue;
      minimum = Math.min(minimum, Math.hypot(leftPosition.x - rightPosition.x, leftPosition.y - rightPosition.y));
    }
  }

  return minimum;
}

describe("graph layout", () => {
  test("returns fallback bounds for empty graphs", () => {
    const layout = layoutGraph([], []);

    expect(layout.positions.size).toBe(0);
    expect(layout.bounds.width).toBe(440);
    expect(layout.bounds.height).toBe(440);
  });

  test("places a single node within finite bounds", () => {
    const layout = layoutGraph([{ id: "only" }], []);
    const position = layout.positions.get("only");

    expect(position).toEqual({ x: 152, y: 152 });
    expect(Number.isFinite(layout.bounds.width)).toBe(true);
    expect(Number.isFinite(layout.bounds.height)).toBe(true);
  });

  test("creates deterministic layered positions for a chain", () => {
    const graphNodes = nodes(5);
    const graphEdges = chainEdges(5);
    const first = layoutGraph(graphNodes, graphEdges);
    const second = layoutGraph(graphNodes, graphEdges);

    expect([...first.positions.entries()]).toEqual([...second.positions.entries()]);
    expect(first.positions.size).toBe(5);
    expect(new Set([...first.positions.values()].map(position => position.y)).size).toBeGreaterThan(1);
  });

  test("keeps hub-and-spoke leaves separated", () => {
    const graphNodes = nodes(7);
    const graphEdges = graphNodes.slice(1).map(node => ({ sourceNodeId: "node-0", targetNodeId: node.id }));
    const layout = layoutGraph(graphNodes, graphEdges);

    expect(layout.positions.get("node-0")?.y).toBe(152);
    expect(minimumDistance(layout)).toBeGreaterThanOrEqual(110);
  });

  test("separates disconnected components", () => {
    const layout = layoutGraph(nodes(6), [
      { sourceNodeId: "node-0", targetNodeId: "node-1" },
      { sourceNodeId: "node-2", targetNodeId: "node-3" },
      { sourceNodeId: "node-4", targetNodeId: "node-5" },
    ]);

    expect(layout.positions.size).toBe(6);
    expect(layout.bounds.width).toBeGreaterThan(440);
  });

  test("lays out a dense 53 node graph without circular compression", () => {
    const graphNodes = nodes(53);
    const graphEdges: LayoutEdge[] = [
      ...chainEdges(53),
      ...Array.from({ length: 14 }, (_, index) => ({ sourceNodeId: `node-${index}`, targetNodeId: `node-${index + 8}` })),
    ];
    const layout = layoutGraph(graphNodes, graphEdges);
    const distinctYCoordinates = new Set([...layout.positions.values()].map(position => position.y));

    expect(layout.positions.size).toBe(53);
    expect(graphEdges.length).toBe(66);
    expect(layout.bounds.height).toBeGreaterThan(440);
    expect(distinctYCoordinates.size).toBeGreaterThan(5);
    expect(minimumDistance(layout)).toBeGreaterThanOrEqual(110);
  });
});
