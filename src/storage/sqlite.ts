import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import path from "path";
import { conflictError, notFoundError, validationError } from "../domain/errors";
import { createId } from "../domain/ids";
import { parseMetadata, parseMetadataSchema } from "../domain/metadata";
import { materializeBootstrapTypes } from "../domain/seed";
import type {
  Actor,
  DeleteResult,
  EdgeTypeDefinition,
  FullGraphExport,
  GraphChange,
  GraphContext,
  GraphEdge,
  GraphNode,
  GraphOperation,
  GraphRecordType,
  GraphSnapshot,
  Metadata,
  MetadataSchema,
  MutationResult,
  NodeTypeDefinition,
  SearchResult,
  WriteOptions,
} from "../domain/types";
import {
  assertDirection,
  assertEdgeTypeUnused,
  assertExpectedVersion,
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

interface TypeRow {
  id: string;
  name: string;
  description: string;
  metadata_schema_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface NodeRow {
  id: string;
  name: string;
  type_id: string;
  description: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface EdgeRow {
  id: string;
  type_id: string;
  source_node_id: string;
  target_node_id: string;
  direction: "directed" | "bidirectional";
  description: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChangeRow {
  version: number;
  actor_id: string;
  actor_display_name: string;
  timestamp: string;
  operation: GraphOperation;
  record_type: GraphRecordType;
  record_id: string;
  before_json: string;
  after_json: string;
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapNodeType(row: TypeRow): NodeTypeDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    metadataSchema: parseJson<MetadataSchema>(row.metadata_schema_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapEdgeType(row: TypeRow): EdgeTypeDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    metadataSchema: parseJson<MetadataSchema>(row.metadata_schema_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    name: row.name,
    typeId: row.type_id,
    description: row.description,
    metadata: parseJson<Metadata>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    typeId: row.type_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    direction: row.direction,
    description: row.description,
    metadata: parseJson<Metadata>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapChange(row: ChangeRow): GraphChange {
  return {
    version: row.version,
    actor: { id: row.actor_id, displayName: row.actor_display_name },
    timestamp: row.timestamp,
    operation: row.operation,
    recordType: row.record_type,
    recordId: row.record_id,
    before: parseJson<unknown>(row.before_json),
    after: parseJson<unknown>(row.after_json),
  };
}

export class SqliteGraphRepository implements GraphRepository {
  private readonly db: Database;

  constructor(sqlitePath: string) {
    if (sqlitePath !== ":memory:") {
      mkdirSync(path.dirname(sqlitePath), { recursive: true });
    }
    this.db = new Database(sqlitePath, { create: true, strict: true });
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO graph_state (key, value) VALUES ('version', '0');

      CREATE TABLE IF NOT EXISTS node_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS edge_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_id TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        type_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('directed', 'bidirectional')),
        description TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS changes (
        version INTEGER PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_display_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_type_id ON nodes(type_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_deleted_at ON nodes(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_edges_type_id ON edges(type_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_deleted_at ON edges(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_node_types_deleted_at ON node_types(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_edge_types_deleted_at ON edge_types(deleted_at);
    `);
  }

  private version(): number {
    const row = this.db.query("SELECT value FROM graph_state WHERE key = 'version'").get() as { value: string } | null;
    return Number(row?.value ?? "0");
  }

  private setVersion(version: number): void {
    this.db.query("UPDATE graph_state SET value = ? WHERE key = 'version'").run(String(version));
  }

  private nextVersion(): number {
    const version = this.version() + 1;
    this.setVersion(version);
    return version;
  }

  private recordChange(
    version: number,
    actor: Actor,
    operation: GraphOperation,
    recordType: GraphRecordType,
    recordId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.db
      .query(
        `INSERT INTO changes
        (version, actor_id, actor_display_name, timestamp, operation, record_type, record_id, before_json, after_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(version, actor.id, actor.displayName, nowIso(), operation, recordType, recordId, stringify(before), stringify(after));
  }

  private allNodeTypes(includeDeleted = false): NodeTypeDefinition[] {
    const rows = this.db
      .query(`SELECT * FROM node_types ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY name`)
      .all() as TypeRow[];
    return rows.map(mapNodeType);
  }

  private allEdgeTypes(includeDeleted = false): EdgeTypeDefinition[] {
    const rows = this.db
      .query(`SELECT * FROM edge_types ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY name`)
      .all() as TypeRow[];
    return rows.map(mapEdgeType);
  }

  private allNodes(includeDeleted = false): GraphNode[] {
    const rows = this.db
      .query(`SELECT * FROM nodes ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY name`)
      .all() as NodeRow[];
    return rows.map(mapNode);
  }

  private allEdges(includeDeleted = false): GraphEdge[] {
    const rows = this.db
      .query(`SELECT * FROM edges ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY id`)
      .all() as EdgeRow[];
    return rows.map(mapEdge);
  }

  getSnapshot(options: { includeDeleted?: boolean } = {}): GraphSnapshot {
    return {
      version: this.version(),
      nodeTypes: this.allNodeTypes(options.includeDeleted),
      edgeTypes: this.allEdgeTypes(options.includeDeleted),
      nodes: this.allNodes(options.includeDeleted),
      edges: this.allEdges(options.includeDeleted),
    };
  }

  getHistory(): GraphChange[] {
    return (this.db.query("SELECT * FROM changes ORDER BY version DESC").all() as ChangeRow[]).map(mapChange);
  }

  getHistoryVersion(version: number): GraphChange | null {
    const row = this.db.query("SELECT * FROM changes WHERE version = ?").get(version) as ChangeRow | null;
    return row ? mapChange(row) : null;
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

  private assertWrite(options: WriteOptions): void {
    assertExpectedVersion(options.expectedVersion, this.version());
  }

  createNodeType(input: TypeInput, options: WriteOptions): MutationResult<NodeTypeDefinition> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      assertName(input.name);
      const timestamp = nowIso();
      const record: NodeTypeDefinition = {
        id: createId({ explicitId: input.id, name: input.name, existingIds: this.allNodeTypes(true).map(type => type.id) }),
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        metadataSchema: parseMetadataSchema(input.metadataSchema),
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      this.db
        .query("INSERT INTO node_types VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(record.id, record.name, record.description, stringify(record.metadataSchema), record.createdAt, record.updatedAt, null);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "create", "nodeType", record.id, null, record);
      return { version, record };
    })();
  }

  updateNodeType(id: string, input: Partial<TypeInput>, options: WriteOptions): MutationResult<NodeTypeDefinition> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const before = findActiveNodeType(this.getSnapshot(), id);
      const record: NodeTypeDefinition = {
        ...before,
        name: input.name?.trim() ?? before.name,
        description: input.description?.trim() ?? before.description,
        metadataSchema: input.metadataSchema === undefined ? before.metadataSchema : parseMetadataSchema(input.metadataSchema),
        updatedAt: nowIso(),
      };
      assertName(record.name);
      this.db
        .query("UPDATE node_types SET name = ?, description = ?, metadata_schema_json = ?, updated_at = ? WHERE id = ?")
        .run(record.name, record.description, stringify(record.metadataSchema), record.updatedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "update", "nodeType", id, before, record);
      return { version, record };
    })();
  }

  deleteNodeType(id: string, options: WriteOptions): DeleteResult {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const snapshot = this.getSnapshot();
      const before = findActiveNodeType(snapshot, id);
      assertNodeTypeUnused(snapshot, id);
      const deletedAt = nowIso();
      this.db.query("UPDATE node_types SET deleted_at = ?, updated_at = ? WHERE id = ?").run(deletedAt, deletedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "delete", "nodeType", id, before, { ...before, deletedAt, updatedAt: deletedAt });
      return { version, deletedId: id };
    })();
  }

  createEdgeType(input: TypeInput, options: WriteOptions): MutationResult<EdgeTypeDefinition> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      assertName(input.name);
      const timestamp = nowIso();
      const record: EdgeTypeDefinition = {
        id: createId({ explicitId: input.id, name: input.name, existingIds: this.allEdgeTypes(true).map(type => type.id) }),
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        metadataSchema: parseMetadataSchema(input.metadataSchema),
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      this.db
        .query("INSERT INTO edge_types VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(record.id, record.name, record.description, stringify(record.metadataSchema), record.createdAt, record.updatedAt, null);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "create", "edgeType", record.id, null, record);
      return { version, record };
    })();
  }

  updateEdgeType(id: string, input: Partial<TypeInput>, options: WriteOptions): MutationResult<EdgeTypeDefinition> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const before = findActiveEdgeType(this.getSnapshot(), id);
      const record: EdgeTypeDefinition = {
        ...before,
        name: input.name?.trim() ?? before.name,
        description: input.description?.trim() ?? before.description,
        metadataSchema: input.metadataSchema === undefined ? before.metadataSchema : parseMetadataSchema(input.metadataSchema),
        updatedAt: nowIso(),
      };
      assertName(record.name);
      this.db
        .query("UPDATE edge_types SET name = ?, description = ?, metadata_schema_json = ?, updated_at = ? WHERE id = ?")
        .run(record.name, record.description, stringify(record.metadataSchema), record.updatedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "update", "edgeType", id, before, record);
      return { version, record };
    })();
  }

  deleteEdgeType(id: string, options: WriteOptions): DeleteResult {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const snapshot = this.getSnapshot();
      const before = findActiveEdgeType(snapshot, id);
      assertEdgeTypeUnused(snapshot, id);
      const deletedAt = nowIso();
      this.db.query("UPDATE edge_types SET deleted_at = ?, updated_at = ? WHERE id = ?").run(deletedAt, deletedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "delete", "edgeType", id, before, { ...before, deletedAt, updatedAt: deletedAt });
      return { version, deletedId: id };
    })();
  }

  createNode(input: NodeInput, options: WriteOptions): MutationResult<GraphNode> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      assertName(input.name);
      const snapshot = this.getSnapshot();
      findActiveNodeType(snapshot, input.typeId);
      const metadata = validateNodeMetadata(snapshot, input.typeId, parseMetadata(input.metadata));
      const timestamp = nowIso();
      const record: GraphNode = {
        id: createId({ explicitId: input.id, name: input.name, existingIds: this.allNodes(true).map(node => node.id) }),
        name: input.name.trim(),
        typeId: input.typeId,
        description: input.description?.trim() ?? "",
        metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      this.db
        .query("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(record.id, record.name, record.typeId, record.description, stringify(record.metadata), record.createdAt, record.updatedAt, null);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "create", "node", record.id, null, record);
      return { version, record };
    })();
  }

  updateNode(id: string, input: Partial<NodeInput>, options: WriteOptions): MutationResult<GraphNode> {
    return this.db.transaction(() => {
      this.assertWrite(options);
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
      this.db
        .query("UPDATE nodes SET name = ?, type_id = ?, description = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
        .run(record.name, record.typeId, record.description, stringify(record.metadata), record.updatedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "update", "node", id, before, record);
      return { version, record };
    })();
  }

  deleteNode(id: string, options: WriteOptions): DeleteResult {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const snapshot = this.getSnapshot();
      const before = findActiveNode(snapshot, id);
      const deletedAt = nowIso();
      const connectedEdges = snapshot.edges.filter(edge => edge.sourceNodeId === id || edge.targetNodeId === id);
      this.db.query("UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id = ?").run(deletedAt, deletedAt, id);
      for (const edge of connectedEdges) {
        this.db.query("UPDATE edges SET deleted_at = ?, updated_at = ? WHERE id = ?").run(deletedAt, deletedAt, edge.id);
      }
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "delete", "node", id, { node: before, connectedEdges }, { ...before, deletedAt });
      return { version, deletedId: id };
    })();
  }

  createEdge(input: EdgeInput, options: WriteOptions): MutationResult<GraphEdge> {
    return this.db.transaction(() => {
      this.assertWrite(options);
      assertDirection(input.direction);
      const snapshot = this.getSnapshot();
      findActiveEdgeType(snapshot, input.typeId);
      findActiveNode(snapshot, input.sourceNodeId);
      findActiveNode(snapshot, input.targetNodeId);
      const metadata = validateEdgeMetadata(snapshot, input.typeId, parseMetadata(input.metadata));
      const timestamp = nowIso();
      const fallbackName = `${input.sourceNodeId}-${input.typeId}-${input.targetNodeId}`;
      const record: GraphEdge = {
        id: createId({ explicitId: input.id, name: fallbackName, existingIds: this.allEdges(true).map(edge => edge.id) }),
        typeId: input.typeId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        direction: input.direction,
        description: input.description?.trim() ?? "",
        metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      this.db
        .query("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          record.id,
          record.typeId,
          record.sourceNodeId,
          record.targetNodeId,
          record.direction,
          record.description,
          stringify(record.metadata),
          record.createdAt,
          record.updatedAt,
          null,
        );
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "create", "edge", record.id, null, record);
      return { version, record };
    })();
  }

  updateEdge(id: string, input: Partial<EdgeInput>, options: WriteOptions): MutationResult<GraphEdge> {
    return this.db.transaction(() => {
      this.assertWrite(options);
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
      this.db
        .query(
          "UPDATE edges SET type_id = ?, source_node_id = ?, target_node_id = ?, direction = ?, description = ?, metadata_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          record.typeId,
          record.sourceNodeId,
          record.targetNodeId,
          record.direction,
          record.description,
          stringify(record.metadata),
          record.updatedAt,
          id,
        );
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "update", "edge", id, before, record);
      return { version, record };
    })();
  }

  deleteEdge(id: string, options: WriteOptions): DeleteResult {
    return this.db.transaction(() => {
      this.assertWrite(options);
      const before = findActiveEdge(this.getSnapshot(), id);
      const deletedAt = nowIso();
      this.db.query("UPDATE edges SET deleted_at = ?, updated_at = ? WHERE id = ?").run(deletedAt, deletedAt, id);
      const version = this.nextVersion();
      this.recordChange(version, options.actor, "delete", "edge", id, before, { ...before, deletedAt, updatedAt: deletedAt });
      return { version, deletedId: id };
    })();
  }

  seedBootstrap(actor: Actor): GraphSnapshot {
    return this.db.transaction(() => {
      const existing = this.getSnapshot();
      const seed = materializeBootstrapTypes();
      let changed = false;
      for (const type of seed.nodeTypes) {
        if (!this.allNodeTypes(true).some(existingType => existingType.id === type.id)) {
          this.db
            .query("INSERT INTO node_types VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(type.id, type.name, type.description, stringify(type.metadataSchema), nowIso(), nowIso(), null);
          changed = true;
        }
      }
      for (const type of seed.edgeTypes) {
        if (!this.allEdgeTypes(true).some(existingType => existingType.id === type.id)) {
          this.db
            .query("INSERT INTO edge_types VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(type.id, type.name, type.description, stringify(type.metadataSchema), nowIso(), nowIso(), null);
          changed = true;
        }
      }
      if (changed) {
        const version = this.nextVersion();
        this.recordChange(version, actor, "seed", "graph", "bootstrap", existing, this.getSnapshot());
      }
      return this.getSnapshot();
    })();
  }

  exportGraph(): FullGraphExport {
    const current = this.getSnapshot();
    const all = this.getSnapshot({ includeDeleted: true });
    return {
      ...current,
      tombstones: {
        nodeTypes: all.nodeTypes.filter(record => record.deletedAt !== null),
        edgeTypes: all.edgeTypes.filter(record => record.deletedAt !== null),
        nodes: all.nodes.filter(record => record.deletedAt !== null),
        edges: all.edges.filter(record => record.deletedAt !== null),
      },
      history: this.getHistory().slice().reverse(),
    };
  }

  importGraph(payload: FullGraphExport, actor: Actor): GraphSnapshot {
    return this.db.transaction(() => {
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.nodeTypes) || !Array.isArray(payload.edgeTypes)) {
        throw validationError("Import payload is not a valid graph export.");
      }
      const before = this.exportGraph();
      this.db.exec("DELETE FROM changes; DELETE FROM edges; DELETE FROM nodes; DELETE FROM edge_types; DELETE FROM node_types;");
      const nodeTypes = [...payload.nodeTypes, ...(payload.tombstones?.nodeTypes ?? [])];
      const edgeTypes = [...payload.edgeTypes, ...(payload.tombstones?.edgeTypes ?? [])];
      const nodes = [...payload.nodes, ...(payload.tombstones?.nodes ?? [])];
      const edges = [...payload.edges, ...(payload.tombstones?.edges ?? [])];
      for (const type of nodeTypes) {
        this.db
          .query("INSERT INTO node_types VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(type.id, type.name, type.description, stringify(type.metadataSchema), type.createdAt, type.updatedAt, type.deletedAt);
      }
      for (const type of edgeTypes) {
        this.db
          .query("INSERT INTO edge_types VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(type.id, type.name, type.description, stringify(type.metadataSchema), type.createdAt, type.updatedAt, type.deletedAt);
      }
      for (const node of nodes) {
        this.db
          .query("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(node.id, node.name, node.typeId, node.description, stringify(node.metadata), node.createdAt, node.updatedAt, node.deletedAt);
      }
      for (const edge of edges) {
        this.db
          .query("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            edge.id,
            edge.typeId,
            edge.sourceNodeId,
            edge.targetNodeId,
            edge.direction,
            edge.description,
            stringify(edge.metadata),
            edge.createdAt,
            edge.updatedAt,
            edge.deletedAt,
          );
      }
      const version = Math.max(Number(payload.version ?? 0), before.version) + 1;
      this.setVersion(version);
      this.recordChange(version, actor, "import", "graph", "full", before, this.getSnapshot());
      return this.getSnapshot();
    })();
  }

  requireActiveEdgeForTypeDelete(typeId: string): void {
    const snapshot = this.getSnapshot();
    const activeEdge = snapshot.edges.find(edge => edge.typeId === typeId);
    if (activeEdge) throw conflictError("Active edge uses this type.", { typeId, edgeId: activeEdge.id });
  }

  requireRecordExists(kind: "node" | "edge", id: string): void {
    if (kind === "node") findActiveNode(this.getSnapshot(), id);
    if (kind === "edge") findActiveEdge(this.getSnapshot(), id);
    if (kind !== "node" && kind !== "edge") throw notFoundError("Unsupported record kind.", { kind });
  }
}

