import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./index.css";

type Metadata = Record<string, unknown>;

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

function parseJsonObject(value: string): Metadata {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON fields must contain an object.");
  }
  return parsed as Metadata;
}

export function App() {
  const [graph, setGraph] = useState<GraphSnapshot>(emptyGraph);
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
  const filteredNodes = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return graph.nodes.filter(node => {
      const matchesSearch = !needle || JSON.stringify(node).toLowerCase().includes(needle);
      const matchesType = !nodeTypeFilter || node.typeId === nodeTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [graph.nodes, nodeTypeFilter, search]);
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
          metadata: parseJsonObject(formValue(form, "metadata")),
        }),
      }),
    );
    form.reset();
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
          metadata: parseJsonObject(formValue(form, "metadata")),
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
          metadata: parseJsonObject(formValue(form, "metadata")),
        }),
      }),
    );
    form.reset();
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
          metadata: parseJsonObject(formValue(form, "metadata")),
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
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">Link</p>
            <h1 className="text-3xl font-bold">Project interaction graph</h1>
            <p className="mt-2 max-w-3xl text-slate-300">
              Manage flexible entities, relationship types, metadata, history, and realtime graph updates from one deterministic UI.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm">
            <strong>Version:</strong> {graph.version} · <strong>Nodes:</strong> {graph.nodes.length} · <strong>Edges:</strong>{" "}
            {graph.edges.length}
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Panel title="Graph controls">
            <div className="flex flex-wrap gap-3">
              <button onClick={seed}>Seed bootstrap types</button>
              <button onClick={refresh}>Refresh graph</button>
              <button onClick={exportGraph}>Export graph</button>
              <button onClick={importGraph} disabled={!exportText.trim()}>
                Import from export box
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-300">{message}</p>
            {error && <p className="mt-3 rounded-lg border border-red-500/50 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
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
            <GraphMap graph={{ ...graph, nodes: filteredNodes, edges: filteredEdges }} selectedNodeId={selectedNode?.id ?? ""} onSelect={setSelectedNodeId} />
          </Panel>

          <Panel title="Nodes">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search nodes..." />
            <div className="mt-3 grid gap-2">
              {filteredNodes.map(node => (
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
              ))}
              {filteredNodes.length === 0 && <p className="text-sm text-slate-400">No nodes match the current search.</p>}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel title="Selected node context">
            {selectedNode && context ? (
              <div className="space-y-3">
                <div>
                  <h2 className="text-xl font-semibold">{selectedNode.name}</h2>
                  <p className="text-sm text-cyan-200">{selectedNode.typeId}</p>
                  <p className="mt-2 text-sm text-slate-300">{selectedNode.description || "No description."}</p>
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
                  <textarea name="metadata" defaultValue={JSON.stringify(selectedNode.metadata, null, 2)} placeholder="Metadata JSON" />
                  <button>Save node changes</button>
                </form>
                <button className="danger" onClick={() => void deleteNode(selectedNode.id)}>
                  Delete node
                </button>
                <h3 className="font-semibold">Connections</h3>
                {context.edges.map(edge => (
                  <div className="rounded-lg border border-slate-800 p-3 text-sm" key={edge.id}>
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
              <p className="text-sm text-slate-400">Create or select a node to inspect its direct connections.</p>
            )}
          </Panel>

          <Panel title="Create node">
            <form onSubmit={createNode}>
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
              <textarea name="metadata" placeholder='Metadata JSON, e.g. {"status":"active"}' />
              <button>Create node</button>
            </form>
          </Panel>

          <Panel title="Create edge">
            <form onSubmit={createEdge}>
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
              <textarea name="metadata" placeholder="Metadata JSON" />
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
                <textarea name="metadata" defaultValue={JSON.stringify(selectedEdge.metadata, null, 2)} placeholder="Metadata JSON" />
                <button>Save edge changes</button>
              </form>
            ) : (
              <p className="text-sm text-slate-400">Create or select an edge from a node context to edit it.</p>
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
              <p className="mt-3 text-sm text-slate-400">Seed or create node types to manage them.</p>
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
              <p className="mt-3 text-sm text-slate-400">Seed or create edge types to manage them.</p>
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
                <div className="rounded-lg border border-slate-800 p-3 text-sm" key={change.version}>
                  <strong>v{change.version}</strong> · {change.operation} {change.recordType}/{change.recordId}
                  <small>
                    {change.actor.displayName} · {new Date(change.timestamp).toLocaleString()}
                  </small>
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-slate-400">Load history to inspect append-only graph changes.</p>}
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-black/20">
      <h2 className="mb-4 text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function GraphMap(props: { graph: GraphSnapshot; selectedNodeId: string; onSelect: (id: string) => void }) {
  const radius = 170;
  const center = 220;
  const positions = new Map(
    props.graph.nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(props.graph.nodes.length, 1);
      return [node.id, { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius }];
    }),
  );

  return (
    <svg viewBox="0 0 440 440" className="h-[440px] w-full rounded-xl border border-slate-800 bg-slate-950">
      {props.graph.edges.map(edge => {
        const source = positions.get(edge.sourceNodeId);
        const target = positions.get(edge.targetNodeId);
        if (!source || !target) return null;
        return (
          <g key={edge.id}>
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#38bdf8" strokeWidth="2" opacity="0.65" />
            <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2} fill="#cbd5e1" fontSize="10">
              {edge.direction === "directed" ? "->" : "<->"}
            </text>
          </g>
        );
      })}
      {props.graph.nodes.map(node => {
        const position = positions.get(node.id);
        if (!position) return null;
        const selected = node.id === props.selectedNodeId;
        return (
          <g key={node.id} onClick={() => props.onSelect(node.id)} className="cursor-pointer">
            <circle cx={position.x} cy={position.y} r={selected ? 25 : 20} fill={selected ? "#f59e0b" : "#0f766e"} />
            <text x={position.x} y={position.y + 36} textAnchor="middle" fill="#e2e8f0" fontSize="11">
              {node.name.slice(0, 18)}
            </text>
          </g>
        );
      })}
      {props.graph.nodes.length === 0 && (
        <text x="220" y="220" textAnchor="middle" fill="#94a3b8">
          Seed types and create nodes to see the graph.
        </text>
      )}
    </svg>
  );
}

export default App;
