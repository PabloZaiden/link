export interface LayoutNode {
  id: string;
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

const horizontalSpacing = 240;
const verticalSpacing = 150;
const componentGap = 240;
const componentPadding = 80;
const nodePadding = 72;
const minimumCanvasSize = 440;

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
  const adjacency = buildAdjacency(nodes, edges, nodeIds);
  const components = findComponents(nodes, adjacency);
  const componentLayouts = components.map(component =>
    layoutComponent(component, adjacency, {
      horizontalSpacing: scaledHorizontalSpacing,
      verticalSpacing: scaledVerticalSpacing,
    }),
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

  return { positions, bounds: calculateBounds([...positions.values()]) };
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
  spacing: { horizontalSpacing: number; verticalSpacing: number },
): ComponentLayout {
  if (component.length === 1) {
    return { positions: new Map([[component[0]!, { x: nodePadding, y: nodePadding }]]), width: nodePadding * 2, height: nodePadding * 2 };
  }

  const componentSet = new Set(component);
  const root = [...component].sort(compareByDegreeThenId(adjacency))[0]!;
  const levels = assignLevels(root, componentSet, adjacency);
  const rows = [...levels.entries()].sort(([left], [right]) => left - right);
  const maxRowSize = Math.max(...rows.map(([, row]) => row.length), 1);
  const width = Math.max((maxRowSize - 1) * spacing.horizontalSpacing + nodePadding * 2, nodePadding * 2);
  const positions = new Map<string, LayoutPosition>();

  for (const [level, rowNodes] of rows) {
    const sortedRow = rowNodes.sort(compareByDegreeThenId(adjacency));
    const rowWidth = (sortedRow.length - 1) * spacing.horizontalSpacing;
    const startX = (width - rowWidth) / 2;

    for (const [index, nodeId] of sortedRow.entries()) {
      positions.set(nodeId, { x: startX + index * spacing.horizontalSpacing, y: nodePadding + level * spacing.verticalSpacing });
    }
  }

  const height = Math.max((rows.length - 1) * spacing.verticalSpacing + nodePadding * 2, nodePadding * 2);
  return { positions, width, height };
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

function calculateBounds(positions: LayoutPosition[]): LayoutBounds {
  const minPositionX = Math.min(...positions.map(position => position.x));
  const minPositionY = Math.min(...positions.map(position => position.y));
  const maxPositionX = Math.max(...positions.map(position => position.x));
  const maxPositionY = Math.max(...positions.map(position => position.y));
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
  return Math.min(10, Math.max(0.6, value));
}
