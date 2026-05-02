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

function widestHorizontalGap(layout: ReturnType<typeof layoutGraph>): number {
  const xs = [...layout.positions.values()].map(position => position.x).sort((left, right) => left - right);
  let widestGap = 0;

  for (let index = 1; index < xs.length; index += 1) {
    widestGap = Math.max(widestGap, xs[index]! - xs[index - 1]!);
  }

  return widestGap;
}

function averageX(layout: ReturnType<typeof layoutGraph>, nodeIds: string[]): number {
  return (
    nodeIds.reduce((sum, nodeId) => {
      const position = layout.positions.get(nodeId);
      return sum + (position?.x ?? 0);
    }, 0) / nodeIds.length
  );
}

function averageDistanceFrom(layout: ReturnType<typeof layoutGraph>, anchorId: string, nodeIds: string[]): number {
  const anchor = layout.positions.get(anchorId)!;
  return (
    nodeIds.reduce((sum, nodeId) => {
      const position = layout.positions.get(nodeId)!;
      return sum + Math.hypot(position.x - anchor.x, position.y - anchor.y);
    }, 0) / nodeIds.length
  );
}

function minimumClearance(layout: ReturnType<typeof layoutGraph>, graphNodes: LayoutNode[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  const radiusById = new Map(graphNodes.map(node => [node.id, node.radius ?? 0]));
  const entries = [...layout.positions.entries()];

  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEntry = entries[left];
      const rightEntry = entries[right];
      if (!leftEntry || !rightEntry) continue;
      const [leftId, leftPosition] = leftEntry;
      const [rightId, rightPosition] = rightEntry;
      const distance = Math.hypot(leftPosition.x - rightPosition.x, leftPosition.y - rightPosition.y);
      const clearance = distance - (radiusById.get(leftId) ?? 0) - (radiusById.get(rightId) ?? 0);
      minimum = Math.min(minimum, clearance);
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

    expect(layout.positions.get("node-0")).toBeDefined();
    expect(averageDistanceFrom(layout, "node-0", graphNodes.slice(1).map(node => node.id))).toBeGreaterThanOrEqual(150);
    expect(minimumDistance(layout)).toBeGreaterThanOrEqual(110);
  });

  test("gives high-degree nodes more room around them", () => {
    const highDegreeNodes = nodes(10);
    const lowDegreeNodes = nodes(5);
    const hubLayout = layoutGraph(highDegreeNodes, highDegreeNodes.slice(1).map(node => ({ sourceNodeId: "node-0", targetNodeId: node.id })));
    const smallerHubLayout = layoutGraph(lowDegreeNodes, lowDegreeNodes.slice(1).map(node => ({ sourceNodeId: "node-0", targetNodeId: node.id })));

    expect(averageDistanceFrom(hubLayout, "node-0", highDegreeNodes.slice(1).map(node => node.id))).toBeGreaterThan(
      averageDistanceFrom(smallerHubLayout, "node-0", lowDegreeNodes.slice(1).map(node => node.id)),
    );
  });

  test("keeps large rendered nodes from overlapping", () => {
    const graphNodes: LayoutNode[] = [
      { id: "hub", radius: 84 },
      { id: "a", radius: 28 },
      { id: "b", radius: 28 },
      { id: "c", radius: 28 },
      { id: "d", radius: 28 },
      { id: "e", radius: 28 },
      { id: "f", radius: 28 },
    ];
    const graphEdges: LayoutEdge[] = graphNodes
      .slice(1)
      .map(node => ({ sourceNodeId: "hub", targetNodeId: node.id }));

    const layout = layoutGraph(graphNodes, graphEdges);

    expect(minimumClearance(layout, graphNodes)).toBeGreaterThanOrEqual(0);
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
    expect(distinctYCoordinates.size).toBeGreaterThan(12);
    expect(minimumDistance(layout)).toBeGreaterThanOrEqual(110);
  });

  test("creates visible separation between dense subclusters", () => {
    const graphNodes = nodes(16);
    const clusterA = [0, 1, 2, 3, 4, 5, 6, 7];
    const clusterB = [8, 9, 10, 11, 12, 13, 14, 15];
    const denseEdges = (cluster: number[]) =>
      cluster.flatMap((source, sourceIndex) =>
        cluster.slice(sourceIndex + 1).map(target => ({ sourceNodeId: `node-${source}`, targetNodeId: `node-${target}` })),
      );
    const bridgeEdges: LayoutEdge[] = [
      { sourceNodeId: "node-1", targetNodeId: "node-8" },
      { sourceNodeId: "node-3", targetNodeId: "node-10" },
    ];

    const layout = layoutGraph(graphNodes, [...denseEdges(clusterA), ...denseEdges(clusterB), ...bridgeEdges]);

    expect(layout.positions.size).toBe(16);
    expect(widestHorizontalGap(layout)).toBeGreaterThanOrEqual(160);
    expect(layout.bounds.width).toBeGreaterThan(1000);
  });

  test("packs more strongly connected clusters closer together", () => {
    const graphNodes = nodes(18);
    const clusterA = [0, 1, 2, 3, 4, 5];
    const clusterB = [6, 7, 8, 9, 10, 11];
    const clusterC = [12, 13, 14, 15, 16, 17];
    const denseEdges = (cluster: number[]) =>
      cluster.flatMap((source, sourceIndex) =>
        cluster.slice(sourceIndex + 1).map(target => ({ sourceNodeId: `node-${source}`, targetNodeId: `node-${target}` })),
      );

    const layout = layoutGraph(graphNodes, [
      ...denseEdges(clusterA),
      ...denseEdges(clusterB),
      ...denseEdges(clusterC),
      { sourceNodeId: "node-0", targetNodeId: "node-6" },
      { sourceNodeId: "node-1", targetNodeId: "node-7" },
      { sourceNodeId: "node-2", targetNodeId: "node-8" },
      { sourceNodeId: "node-3", targetNodeId: "node-9" },
      { sourceNodeId: "node-10", targetNodeId: "node-12" },
    ]);

    const centerA = averageX(layout, clusterA.map(index => `node-${index}`));
    const centerB = averageX(layout, clusterB.map(index => `node-${index}`));
    const centerC = averageX(layout, clusterC.map(index => `node-${index}`));

    expect(Math.abs(centerA - centerB)).toBeLessThan(Math.abs(centerA - centerC));
  });
});
