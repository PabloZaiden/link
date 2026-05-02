export interface LayoutNode {
  id: string;
  radius?: number;
}

export interface LayoutEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, LayoutPosition>;
  bounds: LayoutBounds;
}

export interface LayoutOptions {
  spacingMultiplier?: number;
}

interface ComponentLayout {
  positions: Map<string, LayoutPosition>;
  width: number;
  height: number;
}

interface ClusterLayoutSpacing {
  horizontalSpacing: number;
  verticalSpacing: number;
}

interface ClusterDefinition {
  seed: string;
  nodes: string[];
}

interface ClusterLayoutItem {
  cluster: ClusterDefinition;
  layout: ComponentLayout;
}

const horizontalSpacing = 240;
const verticalSpacing = 150;
const componentGap = 240;
const componentPadding = 80;
const nodePadding = 72;
const minimumCanvasSize = 440;

function degreeForNode(nodeId: string, adjacency: Map<string, Set<string>>): number {
  return adjacency.get(nodeId)?.size ?? 0;
}

function radiusForNode(nodeId: string, nodeRadii: Map<string, number>): number {
  return nodeRadii.get(nodeId) ?? 0;
}

function desiredArcLength(nodeId: string, adjacency: Map<string, Set<string>>, baseSpacing: number, nodeRadii: Map<string, number>): number {
  const degree = degreeForNode(nodeId, adjacency);
  const radius = radiusForNode(nodeId, nodeRadii);
  const degreeSpacing = baseSpacing * (0.9 + Math.pow(degree + 1, 0.68) * 0.33);
  const radiusSpacing = radius * 2 + Math.max(8, baseSpacing * 0.12);
  return Math.max(degreeSpacing, radiusSpacing);
}

export function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[], options: LayoutOptions = {}): GraphLayout {
  const spacingMultiplier = clampSpacingMultiplier(options.spacingMultiplier ?? 1);
  const scaledHorizontalSpacing = horizontalSpacing * spacingMultiplier;
  const scaledVerticalSpacing = verticalSpacing * spacingMultiplier;
  const scaledComponentGap = componentGap * spacingMultiplier;

  if (nodes.length === 0) {
    return {
      positions: new Map(),
      bounds: {
        minX: 0,
        minY: 0,
        maxX: minimumCanvasSize,
        maxY: minimumCanvasSize,
        width: minimumCanvasSize,
        height: minimumCanvasSize,
      },
    };
  }

  const nodeIds = new Set(nodes.map(node => node.id));
  const nodeRadii = new Map(nodes.map(node => [node.id, node.radius ?? 0]));
  const adjacency = buildAdjacency(nodes, edges, nodeIds);
  const components = findComponents(nodes, adjacency);
  const componentLayouts = components.map(component =>
    layoutComponent(component, adjacency, {
      horizontalSpacing: scaledHorizontalSpacing,
      verticalSpacing: scaledVerticalSpacing,
    }, nodeRadii),
  );
  const columns = Math.max(1, Math.ceil(Math.sqrt(componentLayouts.length)));
  const positions = new Map<string, LayoutPosition>();
  const rowHeights: number[] = [];
  const columnWidths = Array.from({ length: columns }, () => 0);

  for (const [index, component] of componentLayouts.entries()) {
    const column = index % columns;
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, component.width);
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, component.height);
  }

  const columnOffsets = columnWidths.map((_, index) => {
    let offset = componentPadding;
    for (let column = 0; column < index; column += 1) {
      offset += (columnWidths[column] ?? 0) + scaledComponentGap;
    }
    return offset;
  });
  const rowOffsets = rowHeights.map((_, index) => {
    let offset = componentPadding;
    for (let row = 0; row < index; row += 1) {
      offset += (rowHeights[row] ?? 0) + scaledComponentGap;
    }
    return offset;
  });

  for (const [index, component] of componentLayouts.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = columnOffsets[column] ?? componentPadding;
    const offsetY = rowOffsets[row] ?? componentPadding;

    for (const [nodeId, position] of component.positions) {
      positions.set(nodeId, { x: position.x + offsetX, y: position.y + offsetY });
    }
  }

  return { positions, bounds: calculateBounds(positions, nodeRadii) };
}

function buildAdjacency(nodes: LayoutNode[], edges: LayoutEdge[], nodeIds: Set<string>): Map<string, Set<string>> {
  const adjacency = new Map(nodes.map(node => [node.id, new Set<string>()]));

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      continue;
    }

    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }

  return adjacency;
}

function findComponents(nodes: LayoutNode[], adjacency: Map<string, Set<string>>): string[][] {
  const remaining = new Set(nodes.map(node => node.id));
  const components: string[][] = [];

  while (remaining.size > 0) {
    const start = [...remaining].sort(compareByDegreeThenId(adjacency))[0];
    if (!start) break;

    const component: string[] = [];
    const queue = [start];
    remaining.delete(start);

    for (let index = 0; index < queue.length; index += 1) {
      const nodeId = queue[index];
      if (!nodeId) continue;
      component.push(nodeId);

      const neighbors = [...(adjacency.get(nodeId) ?? [])].filter(neighbor => remaining.has(neighbor)).sort(compareByDegreeThenId(adjacency));
      for (const neighbor of neighbors) {
        remaining.delete(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  return components.sort((left, right) => right.length - left.length || left[0]!.localeCompare(right[0]!));
}

function layoutComponent(
  component: string[],
  adjacency: Map<string, Set<string>>,
  spacing: ClusterLayoutSpacing,
  nodeRadii: Map<string, number>,
): ComponentLayout {
  const clusters = partitionComponentIntoClusters(component, adjacency);
  if (clusters.length <= 1) {
    return layoutLayeredComponent(component, adjacency, spacing, nodeRadii);
  }

  const clusterLayouts = clusters.map(cluster => ({
    cluster,
    layout: layoutLayeredComponent(cluster.nodes, adjacency, {
      horizontalSpacing: Math.max(24, spacing.horizontalSpacing * 0.72),
      verticalSpacing: Math.max(18, spacing.verticalSpacing * 0.78),
    }, nodeRadii),
  }));
  const orderedClusterLayouts = orderClusterLayoutsByConnectivity(clusterLayouts, adjacency);

  const columns = Math.max(1, Math.ceil(Math.sqrt(orderedClusterLayouts.length)));
  const clusterGapX = Math.max(28, spacing.horizontalSpacing * 0.6);
  const clusterGapY = Math.max(24, spacing.verticalSpacing * 0.65);
  const rowHeights: number[] = [];
  const columnWidths = Array.from({ length: columns }, () => 0);

  for (const [index, item] of orderedClusterLayouts.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, item.layout.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.layout.height);
  }

  const columnOffsets = columnWidths.map((_, index) => {
    let offset = nodePadding;
    for (let column = 0; column < index; column += 1) {
      offset += (columnWidths[column] ?? 0) + clusterGapX;
    }
    return offset;
  });
  const rowOffsets = rowHeights.map((_, index) => {
    let offset = nodePadding;
    for (let row = 0; row < index; row += 1) {
      offset += (rowHeights[row] ?? 0) + clusterGapY;
    }
    return offset;
  });

  const positions = new Map<string, LayoutPosition>();
  for (const [index, item] of orderedClusterLayouts.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = columnOffsets[column] ?? nodePadding;
    const offsetY = rowOffsets[row] ?? nodePadding;

    for (const [nodeId, position] of item.layout.positions) {
      positions.set(nodeId, { x: position.x + offsetX, y: position.y + offsetY });
    }
  }

  const width =
    columnWidths.reduce((total, columnWidth) => total + columnWidth, 0) +
    Math.max(0, columnWidths.length - 1) * clusterGapX +
    nodePadding * 2;
  const height =
    rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
    Math.max(0, rowHeights.length - 1) * clusterGapY +
    nodePadding * 2;

  return { positions, width, height };
}

function orderClusterLayoutsByConnectivity(clusterLayouts: ClusterLayoutItem[], adjacency: Map<string, Set<string>>): ClusterLayoutItem[] {
  if (clusterLayouts.length <= 2) {
    return clusterLayouts;
  }

  const clusterIndexByNodeId = new Map<string, number>();
  for (const [clusterIndex, item] of clusterLayouts.entries()) {
    for (const nodeId of item.cluster.nodes) {
      clusterIndexByNodeId.set(nodeId, clusterIndex);
    }
  }

  const clusterEdgeWeights = new Map<number, Map<number, number>>();
  for (const [nodeId, neighbors] of adjacency.entries()) {
    const sourceCluster = clusterIndexByNodeId.get(nodeId);
    if (sourceCluster === undefined) {
      continue;
    }

    for (const neighbor of neighbors) {
      const targetCluster = clusterIndexByNodeId.get(neighbor);
      if (targetCluster === undefined || targetCluster === sourceCluster) {
        continue;
      }

      const sourceWeights = clusterEdgeWeights.get(sourceCluster) ?? new Map<number, number>();
      sourceWeights.set(targetCluster, (sourceWeights.get(targetCluster) ?? 0) + 1);
      clusterEdgeWeights.set(sourceCluster, sourceWeights);
    }
  }

  const clusterScores = clusterLayouts.map((item, index) => {
    const connectionWeight = [...(clusterEdgeWeights.get(index)?.values() ?? [])].reduce((sum, weight) => sum + weight, 0);
    return { index, connectionWeight, size: item.cluster.nodes.length, seed: item.cluster.seed };
  });

  const startCluster = [...clusterScores].sort(
    (left, right) =>
      right.connectionWeight - left.connectionWeight || right.size - left.size || left.seed.localeCompare(right.seed),
  )[0]?.index;
  if (startCluster === undefined) {
    return clusterLayouts;
  }

  const orderedIndices: number[] = [];
  const remaining = new Set(clusterLayouts.map((_, index) => index));
  const queue = [startCluster];
  remaining.delete(startCluster);

  while (queue.length > 0) {
    const currentIndex = queue.shift();
    if (currentIndex === undefined) {
      continue;
    }

    orderedIndices.push(currentIndex);
    const neighbors = [...(clusterEdgeWeights.get(currentIndex)?.entries() ?? [])]
      .filter(([neighborIndex]) => remaining.has(neighborIndex))
      .sort(([leftIndex, leftWeight], [rightIndex, rightWeight]) => {
        const leftCluster = clusterLayouts[leftIndex]?.cluster;
        const rightCluster = clusterLayouts[rightIndex]?.cluster;
        return (
          rightWeight - leftWeight ||
          (rightCluster?.nodes.length ?? 0) - (leftCluster?.nodes.length ?? 0) ||
          (leftCluster?.seed ?? "").localeCompare(rightCluster?.seed ?? "")
        );
      });

    for (const [neighborIndex] of neighbors) {
      remaining.delete(neighborIndex);
      queue.push(neighborIndex);
    }

    if (queue.length === 0 && remaining.size > 0) {
      const nextIndex = [...remaining].sort((leftIndex, rightIndex) => {
        const leftCluster = clusterLayouts[leftIndex]?.cluster;
        const rightCluster = clusterLayouts[rightIndex]?.cluster;
        const leftWeight = clusterScores[leftIndex]?.connectionWeight ?? 0;
        const rightWeight = clusterScores[rightIndex]?.connectionWeight ?? 0;
        return (
          rightWeight - leftWeight ||
          (rightCluster?.nodes.length ?? 0) - (leftCluster?.nodes.length ?? 0) ||
          (leftCluster?.seed ?? "").localeCompare(rightCluster?.seed ?? "")
        );
      })[0];

      if (nextIndex !== undefined) {
        remaining.delete(nextIndex);
        queue.push(nextIndex);
      }
    }
  }

  return orderedIndices.map(index => clusterLayouts[index]!).filter(Boolean);
}

function layoutLayeredComponent(
  component: string[],
  adjacency: Map<string, Set<string>>,
  spacing: ClusterLayoutSpacing,
  nodeRadii: Map<string, number>,
): ComponentLayout {
  if (component.length === 1) {
    const radius = radiusForNode(component[0]!, nodeRadii);
    const center = Math.max(nodePadding, radius + nodePadding);
    const diameter = Math.max(nodePadding * 2, center + radius + nodePadding);
    return { positions: new Map([[component[0]!, { x: center, y: center }]]), width: diameter, height: diameter };
  }

  const componentSet = new Set(component);
  const root = [...component].sort(compareByDegreeThenId(adjacency))[0]!;
  const levels = assignLevels(root, componentSet, adjacency);
  const rows = [...levels.entries()].sort(([left], [right]) => left - right);
  const positions = new Map<string, LayoutPosition>();
  const ringRadii = new Map<number, number>();
  const rootRadius = radiusForNode(root, nodeRadii);
  let previousOuterRadius = rootRadius;
  let maxOuterRadius = rootRadius;

  for (const [level, rowNodes] of rows) {
    if (level === 0) {
      continue;
    }

    const requiredCircumference = rowNodes.reduce(
      (sum, nodeId) => sum + desiredArcLength(nodeId, adjacency, spacing.horizontalSpacing, nodeRadii),
      0,
    );
    const requiredRadiusByCount = requiredCircumference / (2 * Math.PI);
    const ringMaxNodeRadius = Math.max(...rowNodes.map(nodeId => radiusForNode(nodeId, nodeRadii)), 0);
    const radialGap = Math.max(8, spacing.verticalSpacing * 0.12);
    const requiredRadiusByPreviousRing = previousOuterRadius + ringMaxNodeRadius + radialGap;
    const requiredRadiusByLevel = level * spacing.verticalSpacing;
    const ringRadius = Math.max(requiredRadiusByCount, requiredRadiusByPreviousRing, requiredRadiusByLevel);

    ringRadii.set(level, ringRadius);
    previousOuterRadius = ringRadius + ringMaxNodeRadius;
    maxOuterRadius = Math.max(maxOuterRadius, previousOuterRadius);
  }

  const center = maxOuterRadius + nodePadding;

  for (const [level, rowNodes] of rows) {
    const sortedRow = rowNodes.sort(compareByDegreeThenId(adjacency));
    if (level === 0) {
      positions.set(sortedRow[0]!, { x: center, y: center });
      continue;
    }

    const baseRadius = ringRadii.get(level) ?? spacing.verticalSpacing;
    const arcLengths = sortedRow.map(nodeId => desiredArcLength(nodeId, adjacency, spacing.horizontalSpacing, nodeRadii));
    const baseAngleOffset = -Math.PI / 2 + ((level % 3) * Math.PI) / 10;
    let bestPositions: Array<[string, LayoutPosition]> = [];
    let bestClearance = Number.NEGATIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < 12; candidateIndex += 1) {
      const candidateOffset = baseAngleOffset + (candidateIndex * 2 * Math.PI) / 12;
      const candidatePositions: Array<[string, LayoutPosition]> = [];
      let currentAngle = candidateOffset;

      for (const [index, nodeId] of sortedRow.entries()) {
        const arcLength = arcLengths[index] ?? spacing.horizontalSpacing;
        const angleSpan = arcLength / baseRadius;
        const angle = currentAngle + angleSpan / 2;
        candidatePositions.push([
          nodeId,
          {
            x: center + baseRadius * Math.cos(angle),
            y: center + baseRadius * Math.sin(angle),
          },
        ]);
        currentAngle += angleSpan;
      }

      let candidateClearance = Number.POSITIVE_INFINITY;
      for (const [nodeId, candidatePosition] of candidatePositions) {
        const candidateRadius = radiusForNode(nodeId, nodeRadii);
        for (const [placedNodeId, placedPosition] of positions) {
          const placedRadius = radiusForNode(placedNodeId, nodeRadii);
          const clearance =
            Math.hypot(candidatePosition.x - placedPosition.x, candidatePosition.y - placedPosition.y) - candidateRadius - placedRadius;
          candidateClearance = Math.min(candidateClearance, clearance);
        }
      }

      if (candidateClearance > bestClearance) {
        bestClearance = candidateClearance;
        bestPositions = candidatePositions;
      }
    }

    for (const [nodeId, position] of bestPositions) {
      positions.set(nodeId, position);
    }
  }

  const diameter = Math.max(nodePadding * 2, maxOuterRadius * 2 + nodePadding * 2);
  const width = diameter;
  const height = diameter;
  return { positions, width, height };
}

function partitionComponentIntoClusters(component: string[], adjacency: Map<string, Set<string>>): ClusterDefinition[] {
  if (component.length < 10) {
    return [{ seed: component[0]!, nodes: [...component].sort(compareByDegreeThenId(adjacency)) }];
  }

  const sortedNodes = [...component].sort(compareByDegreeThenId(adjacency));
  const targetClusterCount = Math.min(6, Math.max(2, Math.round(Math.sqrt(component.length / 2.5))));
  const distanceCache = new Map<string, Map<string, number>>();
  const seeds: string[] = [];

  for (const candidate of sortedNodes) {
    if (seeds.length === 0) {
      seeds.push(candidate);
      continue;
    }

    const nearestSeedDistance = Math.min(...seeds.map(seed => distanceBetween(candidate, seed, adjacency, distanceCache)));
    if (nearestSeedDistance >= 2) {
      seeds.push(candidate);
    }

    if (seeds.length >= targetClusterCount) {
      break;
    }
  }

  if (seeds.length <= 1) {
    return [{ seed: sortedNodes[0]!, nodes: sortedNodes }];
  }

  const clusters = new Map(seeds.map(seed => [seed, [] as string[]]));
  for (const nodeId of sortedNodes) {
    const bestSeed = [...seeds].sort((left, right) => {
      const leftDistance = distanceBetween(nodeId, left, adjacency, distanceCache);
      const rightDistance = distanceBetween(nodeId, right, adjacency, distanceCache);
      return leftDistance - rightDistance || left.localeCompare(right);
    })[0]!;
    clusters.get(bestSeed)?.push(nodeId);
  }

  return [...clusters.entries()]
    .map(([seed, nodes]) => ({ seed, nodes: [...nodes].sort(compareByDegreeThenId(adjacency)) }))
    .filter(cluster => cluster.nodes.length > 0)
    .sort((left, right) => right.nodes.length - left.nodes.length || left.seed.localeCompare(right.seed));
}

function distanceBetween(
  start: string,
  target: string,
  adjacency: Map<string, Set<string>>,
  cache: Map<string, Map<string, number>>,
): number {
  if (start === target) {
    return 0;
  }

  const cachedDistances = cache.get(start);
  if (cachedDistances?.has(target)) {
    return cachedDistances.get(target)!;
  }

  const visited = new Set([start]);
  const queue = [{ nodeId: start, distance: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }

    if (current.nodeId === target) {
      const distances = cache.get(start) ?? new Map<string, number>();
      distances.set(target, current.distance);
      cache.set(start, distances);
      return current.distance;
    }

    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push({ nodeId: neighbor, distance: current.distance + 1 });
    }
  }

  const distances = cache.get(start) ?? new Map<string, number>();
  distances.set(target, Number.POSITIVE_INFINITY);
  cache.set(start, distances);
  return Number.POSITIVE_INFINITY;
}

function assignLevels(root: string, component: Set<string>, adjacency: Map<string, Set<string>>): Map<number, string[]> {
  const levels = new Map<number, string[]>();
  const visited = new Set([root]);
  const queue = [{ nodeId: root, level: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item) continue;

    const existing = levels.get(item.level) ?? [];
    existing.push(item.nodeId);
    levels.set(item.level, existing);

    const neighbors = [...(adjacency.get(item.nodeId) ?? [])]
      .filter(neighbor => component.has(neighbor) && !visited.has(neighbor))
      .sort(compareByDegreeThenId(adjacency));

    for (const neighbor of neighbors) {
      visited.add(neighbor);
      queue.push({ nodeId: neighbor, level: item.level + 1 });
    }
  }

  return levels;
}

function calculateBounds(positions: Map<string, LayoutPosition>, nodeRadii: Map<string, number>): LayoutBounds {
  const entries = [...positions.entries()];
  const minPositionX = Math.min(...entries.map(([nodeId, position]) => position.x - radiusForNode(nodeId, nodeRadii)));
  const minPositionY = Math.min(...entries.map(([nodeId, position]) => position.y - radiusForNode(nodeId, nodeRadii)));
  const maxPositionX = Math.max(...entries.map(([nodeId, position]) => position.x + radiusForNode(nodeId, nodeRadii)));
  const maxPositionY = Math.max(...entries.map(([nodeId, position]) => position.y + radiusForNode(nodeId, nodeRadii)));
  const minX = Math.min(0, minPositionX - nodePadding);
  const minY = Math.min(0, minPositionY - nodePadding);
  const maxX = Math.max(minimumCanvasSize, maxPositionX + nodePadding);
  const maxY = Math.max(minimumCanvasSize, maxPositionY + nodePadding);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function compareByDegreeThenId(adjacency: Map<string, Set<string>>) {
  return (left: string, right: string) => (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0) || left.localeCompare(right);
}

function clampSpacingMultiplier(value: number): number {
  return Math.min(3, Math.max(0.1, value));
}
