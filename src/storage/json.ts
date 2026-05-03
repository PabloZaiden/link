import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { duplicateError, validationError } from "../domain/errors";
import { assertValidId, createId } from "../domain/ids";
import { parseMetadata, parseMetadataSchema } from "../domain/metadata";
import { materializeBootstrapTypes } from "../domain/seed";
import type {
  DeleteResult,
  EdgeTypeDefinition,
  GraphContext,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  Metadata,
  MetadataSchema,
  MutationResult,
  NodeTypeDefinition,
  SearchResult,
} from "../domain/types";
import {
  assertDirection,
  assertEdgeTypeUnused,
  assertName,
  assertNodeTypeUnused,
  findActiveEdge,
  findActiveEdgeType,
  findActiveNode,
  findActiveNodeType,
  nowIso,
  validateEdgeMetadata,
  validateNodeMetadata,
} from "../domain/validation";
import type { EdgeInput, GraphRepository, NodeInput, TypeInput } from "./repository";

type Collection = "nodeTypes" | "edgeTypes" | "nodes" | "edges";
type RecordTypeName = "node type" | "edge type" | "node" | "edge";

interface JsonRepositoryOptions {
  bootstrap?: boolean;
  createDirectories?: boolean;
}

const collectionDirs: Record<Collection, string> = {
  nodeTypes: "node-types",
  edgeTypes: "edge-types",
  nodes: "nodes",
  edges: "edges",
};

const recordTypeNames: Record<Collection, RecordTypeName> = {
  nodeTypes: "node type",
  edgeTypes: "edge type",
  nodes: "node",
  edges: "edge",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string, filePath: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw validationError(`Invalid graph data in ${filePath}: ${field} must be a string.`, { filePath, field, value });
  }
  return value;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entryValue]) => [key, sortObject(entryValue)]));
  }
  return value;
}

function orderedRecord(record: NodeTypeDefinition | EdgeTypeDefinition | GraphNode | GraphEdge): Record<string, unknown> {
  if ("sourceNodeId" in record) {
    return {
      id: record.id,
      typeId: record.typeId,
      sourceNodeId: record.sourceNodeId,
      targetNodeId: record.targetNodeId,
      direction: record.direction,
      description: record.description,
      metadata: sortObject(record.metadata),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  if ("typeId" in record) {
    return {
      id: record.id,
      name: record.name,
      typeId: record.typeId,
      description: record.description,
      metadata: sortObject(record.metadata),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    metadataSchema: sortObject(record.metadataSchema),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function canonicalJson(record: NodeTypeDefinition | EdgeTypeDefinition | GraphNode | GraphEdge): string {
  return `${JSON.stringify(orderedRecord(record), null, 2)}\n`;
}

function fileErrorPrefix(filePath: string): string {
  return `Invalid graph data in ${filePath}`;
}

function shouldIgnoreCollectionEntry(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return fileName.startsWith(".") || lowerName.endsWith(".tmp") || lowerName === "thumbs.db" || lowerName === "desktop.ini";
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  const text = readFileSync(filePath, "utf8");
  if (text.includes("<<<<<<<") || text.includes("=======") || text.includes(">>>>>>>")) {
    throw validationError(`Invalid JSON in ${filePath}: possible unresolved Git merge conflict markers.`);
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) throw validationError(`${fileErrorPrefix(filePath)}: record must be a JSON object.`);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw validationError(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

function assertFileNameMatchesId(filePath: string, id: string): void {
  const expected = `${id}.json`;
  const actual = path.basename(filePath);
  if (actual !== expected) {
    throw validationError(`${fileErrorPrefix(filePath)}: file name must match record id "${id}".`, { filePath, expected, actual, id });
  }
}

function parseTypeRecord(record: Record<string, unknown>, filePath: string): NodeTypeDefinition {
  const id = requiredString(record, "id", filePath);
  assertValidId(id);
  assertFileNameMatchesId(filePath, id);
  return {
    id,
    name: requiredString(record, "name", filePath),
    description: requiredString(record, "description", filePath),
    metadataSchema: parseMetadataSchema(record.metadataSchema),
    createdAt: requiredString(record, "createdAt", filePath),
    updatedAt: requiredString(record, "updatedAt", filePath),
  };
}

function parseNodeRecord(record: Record<string, unknown>, filePath: string): GraphNode {
  const id = requiredString(record, "id", filePath);
  assertValidId(id);
  assertFileNameMatchesId(filePath, id);
  return {
    id,
    name: requiredString(record, "name", filePath),
    typeId: requiredString(record, "typeId", filePath),
    description: requiredString(record, "description", filePath),
    metadata: parseMetadata(record.metadata),
    createdAt: requiredString(record, "createdAt", filePath),
    updatedAt: requiredString(record, "updatedAt", filePath),
  };
}

function parseEdgeRecord(record: Record<string, unknown>, filePath: string): GraphEdge {
  const id = requiredString(record, "id", filePath);
  assertValidId(id);
  assertFileNameMatchesId(filePath, id);
  const direction = requiredString(record, "direction", filePath);
  if (direction !== "directed" && direction !== "bidirectional") {
    throw validationError(`${fileErrorPrefix(filePath)}: direction must be directed or bidirectional.`, { filePath, direction });
  }
  return {
    id,
    typeId: requiredString(record, "typeId", filePath),
    sourceNodeId: requiredString(record, "sourceNodeId", filePath),
    targetNodeId: requiredString(record, "targetNodeId", filePath),
    direction,
    description: requiredString(record, "description", filePath),
    metadata: parseMetadata(record.metadata),
    createdAt: requiredString(record, "createdAt", filePath),
    updatedAt: requiredString(record, "updatedAt", filePath),
  };
}

function sortByName<T extends { name: string; id: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function sortById<T extends { id: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

export class JsonGraphRepository implements GraphRepository {
  constructor(
    private readonly graphPath: string,
    options: JsonRepositoryOptions = {},
  ) {
    const bootstrap = options.bootstrap ?? true;
    const createDirectories = options.createDirectories ?? true;
    if (createDirectories) this.ensureDirectories();
    if (bootstrap && this.isEmpty()) {
      this.seedBootstrap();
    } else {
      this.getSnapshot();
    }
  }

  close(): void {}

  private collectionPath(collection: Collection): string {
    return path.join(this.graphPath, collectionDirs[collection]);
  }

  private recordPath(collection: Collection, id: string): string {
    return path.join(this.collectionPath(collection), `${id}.json`);
  }

  private ensureDirectories(): void {
    mkdirSync(this.graphPath, { recursive: true });
    for (const dir of Object.values(collectionDirs)) {
      mkdirSync(path.join(this.graphPath, dir), { recursive: true });
    }
  }

  private isEmpty(): boolean {
    return (Object.keys(collectionDirs) as Collection[]).every(collection => {
      const dir = this.collectionPath(collection);
      return !existsSync(dir) || readdirSync(dir).filter(file => file.endsWith(".json")).length === 0;
    });
  }

  private readCollection<T extends NodeTypeDefinition | EdgeTypeDefinition | GraphNode | GraphEdge>(collection: Collection, parse: (record: Record<string, unknown>, filePath: string) => T): T[] {
    const dir = this.collectionPath(collection);
    if (!existsSync(dir)) return [];
    const records: T[] = [];
    for (const fileName of readdirSync(dir).sort()) {
      if (shouldIgnoreCollectionEntry(fileName)) continue;
      const filePath = path.join(dir, fileName);
      if (!statSync(filePath).isFile()) continue;
      if (!fileName.endsWith(".json")) {
        throw validationError(`${fileErrorPrefix(filePath)}: graph record files must use the .json extension.`, { filePath });
      }
      const record = parse(parseJsonFile(filePath), filePath);
      const text = readFileSync(filePath, "utf8");
      const canonical = canonicalJson(record);
      if (text !== canonical) {
        throw validationError(`${fileErrorPrefix(filePath)}: JSON is not in canonical format.`, { filePath });
      }
      records.push(record);
    }
    return records;
  }

  private assertUnique(collection: Collection, records: Array<{ id: string }>): void {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) {
        throw duplicateError(`Duplicate ${recordTypeNames[collection]} ID in graph data.`, { collection, id: record.id });
      }
      seen.add(record.id);
    }
  }

  private validateSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
    this.assertUnique("nodeTypes", snapshot.nodeTypes);
    this.assertUnique("edgeTypes", snapshot.edgeTypes);
    this.assertUnique("nodes", snapshot.nodes);
    this.assertUnique("edges", snapshot.edges);

    const nodeTypeIds = new Set(snapshot.nodeTypes.map(type => type.id));
    const edgeTypeIds = new Set(snapshot.edgeTypes.map(type => type.id));
    const nodeIds = new Set(snapshot.nodes.map(node => node.id));

    for (const node of snapshot.nodes) {
      if (!nodeTypeIds.has(node.typeId)) {
        throw validationError(`Invalid graph data: node "${node.id}" typeId "${node.typeId}" does not reference an existing node type.`, { recordType: "node", recordId: node.id, missingId: node.typeId });
      }
      validateNodeMetadata(snapshot, node.typeId, node.metadata);
    }

    for (const edge of snapshot.edges) {
      if (!edgeTypeIds.has(edge.typeId)) {
        throw validationError(`Invalid graph data: edge "${edge.id}" typeId "${edge.typeId}" does not reference an existing edge type.`, { recordType: "edge", recordId: edge.id, missingId: edge.typeId });
      }
      if (!nodeIds.has(edge.sourceNodeId)) {
        throw validationError(`Invalid graph data: edge "${edge.id}" sourceNodeId "${edge.sourceNodeId}" does not reference an existing node.`, { recordType: "edge", recordId: edge.id, missingId: edge.sourceNodeId });
      }
      if (!nodeIds.has(edge.targetNodeId)) {
        throw validationError(`Invalid graph data: edge "${edge.id}" targetNodeId "${edge.targetNodeId}" does not reference an existing node.`, { recordType: "edge", recordId: edge.id, missingId: edge.targetNodeId });
      }
      validateEdgeMetadata(snapshot, edge.typeId, edge.metadata);
    }

    return snapshot;
  }

  getSnapshot(): GraphSnapshot {
    const snapshot = {
      nodeTypes: sortByName(this.readCollection("nodeTypes", parseTypeRecord)),
      edgeTypes: sortByName(this.readCollection("edgeTypes", parseTypeRecord)),
      nodes: sortByName(this.readCollection("nodes", parseNodeRecord)),
      edges: sortById(this.readCollection("edges", parseEdgeRecord)),
    };
    return this.validateSnapshot(snapshot);
  }

  search(query: string): SearchResult {
    const needle = query.trim().toLowerCase();
    const includesNeedle = (value: unknown) => JSON.stringify(value).toLowerCase().includes(needle);
    const snapshot = this.getSnapshot();
    if (!needle) return { nodes: [], nodeTypes: [], edgeTypes: [], edges: [] };
    return {
      nodes: snapshot.nodes.filter(record => includesNeedle(record)),
      nodeTypes: snapshot.nodeTypes.filter(record => includesNeedle(record)),
      edgeTypes: snapshot.edgeTypes.filter(record => includesNeedle(record)),
      edges: snapshot.edges.filter(record => includesNeedle(record)),
    };
  }

  getContext(nodeId: string): GraphContext {
    const snapshot = this.getSnapshot();
    const node = findActiveNode(snapshot, nodeId);
    const edges = snapshot.edges.filter(edge => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
    const nodeIds = new Set(edges.flatMap(edge => [edge.sourceNodeId, edge.targetNodeId]).filter(id => id !== nodeId));
    const nodes = snapshot.nodes.filter(candidate => nodeIds.has(candidate.id));
    return { node, edges, nodes };
  }

  private writeRecord(collection: Collection, record: NodeTypeDefinition | EdgeTypeDefinition | GraphNode | GraphEdge): void {
    const filePath = this.recordPath(collection, record.id);
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tempPath, canonicalJson(record), "utf8");
    renameSync(tempPath, filePath);
  }

  private deleteRecord(collection: Collection, id: string): void {
    const filePath = this.recordPath(collection, id);
    rmSync(filePath);
  }

  private seedBootstrap(): void {
    const seed = materializeBootstrapTypes();
    for (const type of seed.nodeTypes) this.writeRecord("nodeTypes", type);
    for (const type of seed.edgeTypes) this.writeRecord("edgeTypes", type);
  }

  private assertNoIdChange(id: string, inputId: string | undefined): void {
    if (inputId !== undefined && inputId !== "" && inputId !== id) {
      throw validationError("Record IDs are immutable and cannot be changed.", { id, inputId });
    }
  }

  createNodeType(input: TypeInput): MutationResult<NodeTypeDefinition> {
    assertName(input.name);
    const snapshot = this.getSnapshot();
    const timestamp = nowIso();
    const record: NodeTypeDefinition = {
      id: createId({ explicitId: input.id, name: input.name, existingIds: snapshot.nodeTypes.map(type => type.id) }),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      metadataSchema: parseMetadataSchema(input.metadataSchema),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeRecord("nodeTypes", record);
    return { record };
  }

  updateNodeType(id: string, input: Partial<TypeInput>): MutationResult<NodeTypeDefinition> {
    this.assertNoIdChange(id, input.id);
    const before = findActiveNodeType(this.getSnapshot(), id);
    const record: NodeTypeDefinition = {
      ...before,
      name: input.name?.trim() ?? before.name,
      description: input.description?.trim() ?? before.description,
      metadataSchema: input.metadataSchema === undefined ? before.metadataSchema : parseMetadataSchema(input.metadataSchema),
      updatedAt: nowIso(),
    };
    assertName(record.name);
    this.writeRecord("nodeTypes", record);
    return { record };
  }

  deleteNodeType(id: string): DeleteResult {
    const snapshot = this.getSnapshot();
    findActiveNodeType(snapshot, id);
    assertNodeTypeUnused(snapshot, id);
    this.deleteRecord("nodeTypes", id);
    return { deletedId: id };
  }

  createEdgeType(input: TypeInput): MutationResult<EdgeTypeDefinition> {
    assertName(input.name);
    const snapshot = this.getSnapshot();
    const timestamp = nowIso();
    const record: EdgeTypeDefinition = {
      id: createId({ explicitId: input.id, name: input.name, existingIds: snapshot.edgeTypes.map(type => type.id) }),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      metadataSchema: parseMetadataSchema(input.metadataSchema),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeRecord("edgeTypes", record);
    return { record };
  }

  updateEdgeType(id: string, input: Partial<TypeInput>): MutationResult<EdgeTypeDefinition> {
    this.assertNoIdChange(id, input.id);
    const before = findActiveEdgeType(this.getSnapshot(), id);
    const record: EdgeTypeDefinition = {
      ...before,
      name: input.name?.trim() ?? before.name,
      description: input.description?.trim() ?? before.description,
      metadataSchema: input.metadataSchema === undefined ? before.metadataSchema : parseMetadataSchema(input.metadataSchema),
      updatedAt: nowIso(),
    };
    assertName(record.name);
    this.writeRecord("edgeTypes", record);
    return { record };
  }

  deleteEdgeType(id: string): DeleteResult {
    const snapshot = this.getSnapshot();
    findActiveEdgeType(snapshot, id);
    assertEdgeTypeUnused(snapshot, id);
    this.deleteRecord("edgeTypes", id);
    return { deletedId: id };
  }

  createNode(input: NodeInput): MutationResult<GraphNode> {
    assertName(input.name);
    const snapshot = this.getSnapshot();
    findActiveNodeType(snapshot, input.typeId);
    const metadata = validateNodeMetadata(snapshot, input.typeId, parseMetadata(input.metadata));
    const timestamp = nowIso();
    const record: GraphNode = {
      id: createId({ explicitId: input.id, name: input.name, existingIds: snapshot.nodes.map(node => node.id) }),
      name: input.name.trim(),
      typeId: input.typeId,
      description: input.description?.trim() ?? "",
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeRecord("nodes", record);
    return { record };
  }

  updateNode(id: string, input: Partial<NodeInput>): MutationResult<GraphNode> {
    this.assertNoIdChange(id, input.id);
    const snapshot = this.getSnapshot();
    const before = findActiveNode(snapshot, id);
    const typeId = input.typeId ?? before.typeId;
    findActiveNodeType(snapshot, typeId);
    const metadata = validateNodeMetadata(snapshot, typeId, parseMetadata(input.metadata ?? before.metadata));
    const record: GraphNode = {
      ...before,
      name: input.name?.trim() ?? before.name,
      typeId,
      description: input.description?.trim() ?? before.description,
      metadata,
      updatedAt: nowIso(),
    };
    assertName(record.name);
    this.writeRecord("nodes", record);
    return { record };
  }

  deleteNode(id: string): DeleteResult {
    const snapshot = this.getSnapshot();
    findActiveNode(snapshot, id);
    for (const edge of snapshot.edges.filter(candidate => candidate.sourceNodeId === id || candidate.targetNodeId === id)) {
      this.deleteRecord("edges", edge.id);
    }
    this.deleteRecord("nodes", id);
    return { deletedId: id };
  }

  createEdge(input: EdgeInput): MutationResult<GraphEdge> {
    assertDirection(input.direction);
    const snapshot = this.getSnapshot();
    findActiveEdgeType(snapshot, input.typeId);
    findActiveNode(snapshot, input.sourceNodeId);
    findActiveNode(snapshot, input.targetNodeId);
    const metadata = validateEdgeMetadata(snapshot, input.typeId, parseMetadata(input.metadata));
    const timestamp = nowIso();
    const fallbackName = `${input.sourceNodeId}-${input.typeId}-${input.targetNodeId}`;
    const record: GraphEdge = {
      id: createId({ explicitId: input.id, name: fallbackName, existingIds: snapshot.edges.map(edge => edge.id) }),
      typeId: input.typeId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      direction: input.direction,
      description: input.description?.trim() ?? "",
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeRecord("edges", record);
    return { record };
  }

  updateEdge(id: string, input: Partial<EdgeInput>): MutationResult<GraphEdge> {
    this.assertNoIdChange(id, input.id);
    const snapshot = this.getSnapshot();
    const before = findActiveEdge(snapshot, id);
    const typeId = input.typeId ?? before.typeId;
    const sourceNodeId = input.sourceNodeId ?? before.sourceNodeId;
    const targetNodeId = input.targetNodeId ?? before.targetNodeId;
    const direction = input.direction ?? before.direction;
    assertDirection(direction);
    findActiveEdgeType(snapshot, typeId);
    findActiveNode(snapshot, sourceNodeId);
    findActiveNode(snapshot, targetNodeId);
    const metadata = validateEdgeMetadata(snapshot, typeId, parseMetadata(input.metadata ?? before.metadata));
    const record: GraphEdge = {
      ...before,
      typeId,
      sourceNodeId,
      targetNodeId,
      direction,
      description: input.description?.trim() ?? before.description,
      metadata,
      updatedAt: nowIso(),
    };
    this.writeRecord("edges", record);
    return { record };
  }

  deleteEdge(id: string): DeleteResult {
    findActiveEdge(this.getSnapshot(), id);
    this.deleteRecord("edges", id);
    return { deletedId: id };
  }
}

export function validateGraphPath(graphPath: string): GraphSnapshot {
  if (!existsSync(graphPath)) {
    return { nodeTypes: [], edgeTypes: [], nodes: [], edges: [] };
  }
  for (const dir of Object.values(collectionDirs)) {
    const dirPath = path.join(graphPath, dir);
    if (!existsSync(dirPath)) continue;
    if (!statSync(dirPath).isDirectory()) {
      throw validationError(`Invalid graph data in ${dirPath}: expected a directory.`);
    }
  }
  const repository = new JsonGraphRepository(graphPath, { bootstrap: false, createDirectories: false });
  return repository.getSnapshot();
}
