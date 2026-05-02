import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./index.css";

type Metadata = Record<string, unknown>;
type MetadataEntry = { id: string; key: string; value: string };

interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  metadataSchema: Record<string, unknown>;
}

interface GraphNode {
  id: string;
  name: string;
  typeId: string;
  description: string;
  metadata: Metadata;
}

interface GraphEdge {
  id: string;
  typeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction: "directed" | "bidirectional";
  description: string;
  metadata: Metadata;
}

interface GraphSnapshot {
  version: number;
  nodeTypes: TypeDefinition[];
  edgeTypes: TypeDefinition[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphContext {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphChange {
  version: number;
  actor: { id: string; displayName: string };
  timestamp: string;
  operation: string;
  recordType: string;
  recordId: string;
}

const emptyGraph: GraphSnapshot = { version: 0, nodeTypes: [], edgeTypes: [], nodes: [], edges: [] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  return body;
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function metadataFormValue(form: HTMLFormElement, name: string): Metadata {
  const validationError = formValue(form, `${name}ValidationError`);
  if (validationError) {
    throw new Error(validationError);
  }

  return parseJsonObject(formValue(form, name));
}

function parseJsonObject(value: string): Metadata {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON fields must contain an object.");
  }
  return parsed as Metadata;
}

function parseMetadataValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function metadataToEntries(metadata: Metadata): MetadataEntry[] {
  const entries = Object.entries(metadata).map(([key, value], index) => ({
    id: `metadata-${index}-${key}`,
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));

  return entries;
}

function serializeMetadataEntries(entries: MetadataEntry[]): string {
  const metadata: Metadata = {};

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value.trim();

    if (!key && !value) {
      continue;
    }

    if (!key) {
      throw new Error("Metadata property keys are required when a value is provided.");
    }

    if (key in metadata) {
      throw new Error(`Duplicate metadata property: ${key}`);
    }

    metadata[key] = parseMetadataValue(entry.value);
  }

  return JSON.stringify(metadata);
}

export function App() {
  const [graph, setGraph] = useState<GraphSnapshot>(emptyGraph);
  const [createNodeFormVersion, setCreateNodeFormVersion] = useState(0);
  const [createEdgeFormVersion, setCreateEdgeFormVersion] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [context, setContext] = useState<GraphContext | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Loading graph...");
  const [error, setError] = useState("");
  const [exportText, setExportText] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [nodeTypeFilter, setNodeTypeFilter] = useState("");
  const [edgeTypeFilter, setEdgeTypeFilter] = useState("");
  const [selectedNodeTypeId, setSelectedNodeTypeId] = useState("");
  const [selectedEdgeTypeId, setSelectedEdgeTypeId] = useState("");
  const [history, setHistory] = useState<GraphChange[]>([]);

  const selectedNode = graph.nodes.find(node => node.id === selectedNodeId) ?? graph.nodes[0] ?? null;
  const selectedEdge =
    graph.edges.find(edge => edge.id === selectedEdgeId) ?? context?.edges.find(edge => edge.id === selectedEdgeId) ?? context?.edges[0] ?? null;
  const selectedNodeType = graph.nodeTypes.find(type => type.id === selectedNodeTypeId) ?? graph.nodeTypes[0] ?? null;
  const selectedEdgeType = graph.edgeTypes.find(type => type.id === selectedEdgeTypeId) ?? graph.edgeTypes[0] ?? null;
  const graphNodes = useMemo(() => {
    return graph.nodes.filter(node => !nodeTypeFilter || node.typeId === nodeTypeFilter);
  }, [graph.nodes, nodeTypeFilter]);
  const filteredNodes = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) {
      return [];
    }

    return graphNodes.filter(node => JSON.stringify(node).toLowerCase().includes(needle));
  }, [graphNodes, search]);
  const filteredEdges = useMemo(() => {
    return graph.edges.filter(edge => !edgeTypeFilter || edge.typeId === edgeTypeFilter);
  }, [edgeTypeFilter, graph.edges]);

  const refresh = async () => {
    const nextGraph = await api<GraphSnapshot>("/api/graph");
    setGraph(nextGraph);
    setMessage(`Graph loaded at version ${nextGraph.version}.`);
    if (!selectedNodeId && nextGraph.nodes[0]) setSelectedNodeId(nextGraph.nodes[0].id);
  };

  useEffect(() => {
    refresh().catch(err => setError(String(err)));
  }, []);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/realtime`);
    socket.addEventListener("message", event => {
      if (String(event.data).includes("graph.changed")) {
        refresh().catch(err => setError(String(err)));
      }
    });
    return () => socket.close();
  }, []);

  useEffect(() => {
    if (!selectedNode) {
      setContext(null);
      return;
    }
    api<GraphContext>(`/api/nodes/${selectedNode.id}/context`)
      .then(setContext)
      .catch(err => setError(String(err)));
  }, [selectedNode?.id, graph.version]);

  useEffect(() => {
    if (selectedNodeTypeId && !graph.nodeTypes.some(type => type.id === selectedNodeTypeId)) {
      setSelectedNodeTypeId("");
    }
    if (selectedEdgeTypeId && !graph.edgeTypes.some(type => type.id === selectedEdgeTypeId)) {
      setSelectedEdgeTypeId("");
    }
    if (selectedEdgeId && !graph.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId("");
    }
  }, [graph.edgeTypes, graph.edges, graph.nodeTypes, selectedEdgeId, selectedEdgeTypeId, selectedNodeTypeId]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      await refresh();
      setMessage(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const seed = () => run("Bootstrap types seeded.", () => api("/api/admin/seed/bootstrap", { method: "POST", body: "{}" }));

  const createNodeType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run("Node type created.", () =>
      api("/api/node-types", {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: graph.version,
          id: formValue(form, "id") || undefined,
          name: formValue(form, "name"),
          description: formValue(form, "description"),
          metadataSchema: parseJsonObject(formValue(form, "metadataSchema")),
        }),
      }),
    );
    form.reset();
  };

  const createEdgeType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run("Edge type created.", () =>
      api("/api/edge-types", {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: graph.version,
          id: formValue(form, "id") || undefined,
          name: formValue(form, "name"),
          description: formValue(form, "description"),
          metadataSchema: parseJsonObject(formValue(form, "metadataSchema")),
        }),
      }),
    );
    form.reset();
  };

  const updateNodeType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedNodeType) return;
    const form = event.currentTarget;
    void run("Node type updated.", () =>
      api(`/api/node-types/${selectedNodeType.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: graph.version,
          name: formValue(form, "name"),
          description: formValue(form, "description"),
          metadataSchema: parseJsonObject(formValue(form, "metadataSchema")),
        }),
      }),
    );
  };

  const updateEdgeType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEdgeType) return;
    const form = event.currentTarget;
    void run("Edge type updated.", () =>
      api(`/api/edge-types/${selectedEdgeType.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: graph.version,
          name: formValue(form, "name"),
          description: formValue(form, "description"),
          metadataSchema: parseJsonObject(formValue(form, "metadataSchema")),
        }),
      }),
    );
  };

  const createNode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run("Node created.", () =>
      api("/api/nodes", {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: graph.version,
          id: formValue(form, "id") || undefined,
          name: formValue(form, "name"),
          typeId: formValue(form, "typeId"),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
    form.reset();
    setCreateNodeFormVersion(version => version + 1);
  };

  const updateNode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedNode) return;
    const form = event.currentTarget;
    void run("Node updated.", () =>
      api(`/api/nodes/${selectedNode.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: graph.version,
          name: formValue(form, "name"),
          typeId: formValue(form, "typeId"),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
  };

  const createEdge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run("Edge created.", () =>
      api("/api/edges", {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: graph.version,
          id: formValue(form, "id") || undefined,
          typeId: formValue(form, "typeId"),
          sourceNodeId: formValue(form, "sourceNodeId"),
          targetNodeId: formValue(form, "targetNodeId"),
          direction: formValue(form, "direction"),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
    form.reset();
    setCreateEdgeFormVersion(version => version + 1);
  };

  const updateEdge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEdge) return;
    const form = event.currentTarget;
    void run("Edge updated.", () =>
      api(`/api/edges/${selectedEdge.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: graph.version,
          typeId: formValue(form, "typeId"),
          sourceNodeId: formValue(form, "sourceNodeId"),
          targetNodeId: formValue(form, "targetNodeId"),
          direction: formValue(form, "direction"),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
  };

  const deleteNode = (id: string) =>
    run("Node deleted.", () => api(`/api/nodes/${id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: graph.version }) }));

  const deleteEdge = (id: string) =>
    run("Edge deleted.", () => api(`/api/edges/${id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: graph.version }) }));

  const deleteNodeType = (id: string) =>
    run("Node type deleted.", () => api(`/api/node-types/${id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: graph.version }) }));

  const deleteEdgeType = (id: string) =>
    run("Edge type deleted.", () => api(`/api/edge-types/${id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: graph.version }) }));

  const exportGraph = () =>
    run("Graph exported.", async () => {
      const exported = await api<unknown>("/api/export");
      setExportText(JSON.stringify(exported, null, 2));
    });

  const importGraph = () =>
    run("Graph imported.", () =>
      api("/api/import", {
        method: "POST",
        body: exportText,
      }),
    );

  const loadHistory = () =>
    run("History loaded.", async () => {
      setHistory(await api<GraphChange[]>("/api/history"));
    });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-violet-300">Link</p>
            <h1 className="text-3xl font-bold">Project interaction graph</h1>
            <p className="mt-2 max-w-3xl text-zinc-300">
              Manage flexible entities, relationship types, metadata, history, and realtime graph updates from one deterministic UI.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">
            <strong>Version:</strong> {graph.version} · <strong>Nodes:</strong> {graph.nodes.length} · <strong>Edges:</strong>{" "}
            {graph.edges.length}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <Panel title="Graph controls">
          <div className="flex flex-wrap gap-3">
            <button onClick={seed}>Seed bootstrap types</button>
            <button onClick={refresh}>Refresh graph</button>
            <button onClick={exportGraph}>Export graph</button>
            <button onClick={importGraph} disabled={!exportText.trim()}>
              Import from export box
            </button>
          </div>
          <p className="mt-3 text-sm text-zinc-300">{message}</p>
          {error && <p className="mt-3 rounded-lg border border-violet-500/20 bg-zinc-900 p-3 text-sm text-zinc-200">{error}</p>}
        </Panel>

        <Panel title="Graph map">
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <select value={nodeTypeFilter} onChange={event => setNodeTypeFilter(event.target.value)}>
              <option value="">All node types</option>
              {graph.nodeTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <select value={edgeTypeFilter} onChange={event => setEdgeTypeFilter(event.target.value)}>
              <option value="">All edge types</option>
              {graph.edgeTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <GraphMap
            graph={{ ...graph, nodes: graphNodes, edges: filteredEdges }}
            selectedNodeId={selectedNode?.id ?? ""}
            selectedEdgeId={selectedEdge?.id ?? ""}
            onSelectNode={id => {
              setSelectedNodeId(id);
              setSelectedEdgeId("");
            }}
            onSelectEdge={setSelectedEdgeId}
          />
        </Panel>

        <Panel title="Nodes">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search nodes..." />
          <div className="mt-3 grid gap-2">
            {!search.trim() ? (
              <p className="text-sm text-zinc-400">Enter a search term to list matching nodes.</p>
            ) : filteredNodes.length === 0 ? (
              <p className="text-sm text-zinc-400">No nodes match the current search.</p>
            ) : (
              filteredNodes.map(node => (
                <button
                  className={node.id === selectedNode?.id ? "selected item" : "item"}
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span>
                    <strong>{node.name}</strong>
                    <small>{node.typeId}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Selected node context">
            {selectedNode && context ? (
              <div className="space-y-3">
                <div>
                  <h2 className="text-xl font-semibold">{selectedNode.name}</h2>
                  <p className="text-sm text-violet-200">{selectedNode.typeId}</p>
                  <p className="mt-2 text-sm text-zinc-300">{selectedNode.description || "No description."}</p>
                </div>
                <pre>{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
                <form key={selectedNode.id} onSubmit={updateNode}>
                  <h3 className="font-semibold">Edit node</h3>
                  <input name="name" defaultValue={selectedNode.name} placeholder="Name" required />
                  <select name="typeId" defaultValue={selectedNode.typeId} required>
                    {graph.nodeTypes.map(type => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                  <textarea name="description" defaultValue={selectedNode.description} placeholder="Description" />
                  <MetadataEditor name="metadata" initialMetadata={selectedNode.metadata} />
                  <button>Save node changes</button>
                </form>
                <button className="danger" onClick={() => void deleteNode(selectedNode.id)}>
                  Delete node
                </button>
                <h3 className="font-semibold">Connections</h3>
                {context.edges.map(edge => (
                  <div className="rounded-lg border border-zinc-800 p-3 text-sm" key={edge.id}>
                    <strong>{edge.typeId}</strong> · {edge.sourceNodeId} {edge.direction === "directed" ? "->" : "<->"} {edge.targetNodeId}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => setSelectedEdgeId(edge.id)}>Edit edge</button>
                      <button className="danger" onClick={() => void deleteEdge(edge.id)}>
                        Delete edge
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Create or select a node to inspect its direct connections.</p>
            )}
          </Panel>

          <Panel title="Create node">
            <form key={createNodeFormVersion} onSubmit={createNode}>
              <input name="id" placeholder="optional-id" />
              <input name="name" placeholder="Name" required />
              <select name="typeId" required>
                <option value="">Select node type</option>
                {graph.nodeTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              <textarea name="description" placeholder="Description" />
              <MetadataEditor name="metadata" />
              <button>Create node</button>
            </form>
          </Panel>

          <Panel title="Create edge">
            <form key={createEdgeFormVersion} onSubmit={createEdge}>
              <input name="id" placeholder="optional-id" />
              <select name="typeId" required>
                <option value="">Select edge type</option>
                {graph.edgeTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              <select name="sourceNodeId" required>
                <option value="">Source node</option>
                {graph.nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <select name="targetNodeId" required>
                <option value="">Target node</option>
                {graph.nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <select name="direction">
                <option value="directed">Directed</option>
                <option value="bidirectional">Bidirectional</option>
              </select>
              <textarea name="description" placeholder="Description" />
              <MetadataEditor name="metadata" />
              <button>Create edge</button>
            </form>
          </Panel>

          <Panel title="Edit selected edge">
            {selectedEdge ? (
              <form key={selectedEdge.id} onSubmit={updateEdge}>
                <select name="typeId" defaultValue={selectedEdge.typeId} required>
                  {graph.edgeTypes.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <select name="sourceNodeId" defaultValue={selectedEdge.sourceNodeId} required>
                  {graph.nodes.map(node => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
                <select name="targetNodeId" defaultValue={selectedEdge.targetNodeId} required>
                  {graph.nodes.map(node => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
                <select name="direction" defaultValue={selectedEdge.direction}>
                  <option value="directed">Directed</option>
                  <option value="bidirectional">Bidirectional</option>
                </select>
                <textarea name="description" defaultValue={selectedEdge.description} placeholder="Description" />
                <MetadataEditor name="metadata" initialMetadata={selectedEdge.metadata} />
                <button>Save edge changes</button>
              </form>
            ) : (
              <p className="text-sm text-zinc-400">Create or select an edge from a node context to edit it.</p>
            )}
          </Panel>

          <Panel title="Create types">
            <form onSubmit={createNodeType}>
              <h3>Node type</h3>
              <input name="id" placeholder="optional-id" />
              <input name="name" placeholder="Name" required />
              <textarea name="description" placeholder="Description" />
              <textarea name="metadataSchema" placeholder='Schema JSON, e.g. {"status":{"type":"string"}}' />
              <button>Create node type</button>
            </form>
            <form className="mt-4" onSubmit={createEdgeType}>
              <h3>Edge type</h3>
              <input name="id" placeholder="optional-id" />
              <input name="name" placeholder="Name" required />
              <textarea name="description" placeholder="Description" />
              <textarea name="metadataSchema" placeholder='Schema JSON, e.g. {"confidence":{"type":"number"}}' />
              <button>Create edge type</button>
            </form>
          </Panel>

          <Panel title="Manage node types">
            <select value={selectedNodeType?.id ?? ""} onChange={event => setSelectedNodeTypeId(event.target.value)}>
              {graph.nodeTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            {selectedNodeType ? (
              <form key={selectedNodeType.id} className="mt-3" onSubmit={updateNodeType}>
                <small>ID: {selectedNodeType.id}</small>
                <input name="name" defaultValue={selectedNodeType.name} placeholder="Name" required />
                <textarea name="description" defaultValue={selectedNodeType.description} placeholder="Description" />
                <textarea
                  name="metadataSchema"
                  defaultValue={JSON.stringify(selectedNodeType.metadataSchema, null, 2)}
                  placeholder="Metadata schema JSON"
                />
                <div className="flex flex-wrap gap-2">
                  <button>Save node type changes</button>
                  <button type="button" className="danger" onClick={() => void deleteNodeType(selectedNodeType.id)}>
                    Delete node type
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">Seed or create node types to manage them.</p>
            )}
          </Panel>

          <Panel title="Manage edge types">
            <select value={selectedEdgeType?.id ?? ""} onChange={event => setSelectedEdgeTypeId(event.target.value)}>
              {graph.edgeTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            {selectedEdgeType ? (
              <form key={selectedEdgeType.id} className="mt-3" onSubmit={updateEdgeType}>
                <small>ID: {selectedEdgeType.id}</small>
                <input name="name" defaultValue={selectedEdgeType.name} placeholder="Name" required />
                <textarea name="description" defaultValue={selectedEdgeType.description} placeholder="Description" />
                <textarea
                  name="metadataSchema"
                  defaultValue={JSON.stringify(selectedEdgeType.metadataSchema, null, 2)}
                  placeholder="Metadata schema JSON"
                />
                <div className="flex flex-wrap gap-2">
                  <button>Save edge type changes</button>
                  <button type="button" className="danger" onClick={() => void deleteEdgeType(selectedEdgeType.id)}>
                    Delete edge type
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">Seed or create edge types to manage them.</p>
            )}
          </Panel>

          <Panel title="Import / export">
            <textarea
              className="min-h-72 font-mono text-xs"
              value={exportText}
              onChange={event => setExportText(event.target.value)}
              placeholder="Exported graph JSON appears here and can be imported back."
            />
          </Panel>

          <Panel title="History">
            <button onClick={loadHistory}>Load history</button>
            <div className="mt-3 grid gap-2">
              {history.slice(0, 12).map(change => (
                <div className="rounded-lg border border-zinc-800 p-3 text-sm" key={change.version}>
                  <strong>v{change.version}</strong> · {change.operation} {change.recordType}/{change.recordId}
                  <small>
                    {change.actor.displayName} · {new Date(change.timestamp).toLocaleString()}
                  </small>
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-zinc-400">Load history to inspect append-only graph changes.</p>}
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl shadow-black/20">
      <h2 className="mb-4 text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function MetadataEditor(props: { name: string; initialMetadata?: Metadata }) {
  const [entries, setEntries] = useState<MetadataEntry[]>(() => metadataToEntries(props.initialMetadata ?? {}));

  useEffect(() => {
    setEntries(metadataToEntries(props.initialMetadata ?? {}));
  }, [props.initialMetadata]);

  const validation = useMemo(() => {
    try {
      return { serializedValue: serializeMetadataEntries(entries), error: "" };
    } catch (err) {
      return { serializedValue: "{}", error: err instanceof Error ? err.message : String(err) };
    }
  }, [entries]);

  const updateEntry = (id: string, field: "key" | "value", value: string) => {
    setEntries(current => current.map(entry => (entry.id === id ? { ...entry, [field]: value } : entry)));
  };

  const addEntry = () => {
    setEntries(current => [...current, { id: `metadata-row-${crypto.randomUUID()}`, key: "", value: "" }]);
  };

  const removeEntry = (id: string) => {
    setEntries(current => current.filter(entry => entry.id !== id));
  };

  return (
    <div className="space-y-3">
      <input name={props.name} type="hidden" value={validation.serializedValue} readOnly />
      <input name={`${props.name}ValidationError`} type="hidden" value={validation.error} readOnly />
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <small className="!mb-0">Extra properties</small>
          <button type="button" onClick={addEntry} className="h-8 w-8 px-0 text-lg leading-none" aria-label="Add property" title="Add property">
            +
          </button>
        </div>
        {entries.length === 0 && <small>No extra properties yet.</small>}
        {entries.map(entry => (
          <div key={entry.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-start">
            <input value={entry.key} onChange={event => updateEntry(entry.id, "key", event.target.value)} placeholder="Key" />
            <input
              value={entry.value}
              onChange={event => updateEntry(entry.id, "value", event.target.value)}
              placeholder='Value, e.g. active, 3, true, or {"tier":"gold"}'
            />
            <button type="button" className="danger" onClick={() => removeEntry(entry.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {validation.error ? (
        <p className="rounded-lg border border-violet-500/20 bg-zinc-900 p-3 text-sm text-zinc-200">{validation.error}</p>
      ) : (
        <small>Values are stored as JSON. Numbers, booleans, arrays, and objects are parsed automatically.</small>
      )}
    </div>
  );
}

function GraphMap(props: {
  graph: GraphSnapshot;
  selectedNodeId: string;
  selectedEdgeId: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const radius = 170;
  const center = 220;
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; hasDragged: boolean } | null>(null);
  const positions = new Map(
    props.graph.nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(props.graph.nodes.length, 1);
      return [node.id, { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius }];
    }),
  );

  const clampScale = (nextScale: number) => Math.min(3, Math.max(0.5, nextScale));

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    setScale(current => clampScale(current * zoomFactor));
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      dragStateRef.current = null;
      return;
    }

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      hasDragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    const hasDragged =
      dragState.hasDragged || Math.abs(event.clientX - dragState.startX) > 3 || Math.abs(event.clientY - dragState.startY) > 3;
    dragStateRef.current = {
      ...dragState,
      lastX: event.clientX,
      lastY: event.clientY,
      hasDragged,
    };

    if (hasDragged && (deltaX !== 0 || deltaY !== 0)) {
      setOffset(current => ({ x: current.x + deltaX, y: current.y + deltaY }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleResetViewport = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-300">
        <p>Scroll to zoom. Drag to pan.</p>
        <button type="button" onClick={handleResetViewport}>
          Reset view
        </button>
      </div>
      <svg
        viewBox="0 0 440 440"
        className="h-[440px] w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: dragStateRef.current ? "grabbing" : "grab", touchAction: "none" }}
      >
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {props.graph.edges.map(edge => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (!source || !target) return null;
            const selected = edge.id === props.selectedEdgeId;
            return (
              <g key={edge.id} className="cursor-pointer">
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="transparent"
                  strokeWidth="14"
                  pointerEvents="stroke"
                  onClick={() => props.onSelectEdge(edge.id)}
                />
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={selected ? "#a78bfa" : "#64748b"}
                  strokeWidth={selected ? "3" : "2"}
                  opacity={selected ? "0.95" : "0.7"}
                  onClick={() => props.onSelectEdge(edge.id)}
                />
              </g>
            );
          })}
          {props.graph.nodes.map(node => {
            const position = positions.get(node.id);
            if (!position) return null;
            const selected = node.id === props.selectedNodeId;
            const label = node.name.slice(0, 18);
            const labelWidth = Math.min(label.length * 7 + 12, 140);
            return (
              <g key={node.id} className="cursor-pointer">
                <circle cx={position.x} cy={position.y} r={30} fill="transparent" pointerEvents="all" onClick={() => props.onSelectNode(node.id)} />
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={selected ? 25 : 20}
                  fill={selected ? "#8b5cf6" : "#475569"}
                  onClick={() => props.onSelectNode(node.id)}
                />
                <rect
                  x={position.x - labelWidth / 2}
                  y={position.y + 24}
                  width={labelWidth}
                  height={20}
                  fill="transparent"
                  rx="4"
                  pointerEvents="all"
                  onClick={() => props.onSelectNode(node.id)}
                />
                <text x={position.x} y={position.y + 36} textAnchor="middle" fill="#e4e4e7" fontSize="11" pointerEvents="none">
                  {label}
                </text>
              </g>
            );
          })}
          {props.graph.nodes.length === 0 && (
            <text x="220" y="220" textAnchor="middle" fill="#a1a1aa">
              Seed types and create nodes to see the graph.
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}

export default App;
