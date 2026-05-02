import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./index.css";
import { layoutGraph } from "./graph/layout";

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

type EditorTab = "current" | "new-node" | "new-edge" | "types";

interface PendingSelection {
  nodeId: string;
  edgeId: string;
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

function edgeDirectionFormValue(form: HTMLFormElement): GraphEdge["direction"] {
  return new FormData(form).get("bidirectional") ? "bidirectional" : "directed";
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

export function App() {
  const [graph, setGraph] = useState<GraphSnapshot>(emptyGraph);
  const [createNodeFormVersion, setCreateNodeFormVersion] = useState(0);
  const [createEdgeFormVersion, setCreateEdgeFormVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<EditorTab>("current");
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
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [pendingTab, setPendingTab] = useState<EditorTab | null>(null);
  const nodeFormRef = useRef<HTMLFormElement | null>(null);
  const edgeFormRefs = useRef<Record<string, HTMLFormElement | null>>({});

  const selectedNode = graph.nodes.find(node => node.id === selectedNodeId) ?? graph.nodes[0] ?? null;
  const selectedEdge = selectedEdgeId
    ? graph.edges.find(edge => edge.id === selectedEdgeId) ?? context?.edges.find(edge => edge.id === selectedEdgeId) ?? null
    : null;
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
    const visibleNodeIds = new Set(graphNodes.map(node => node.id));
    return graph.edges.filter(
      edge =>
        (!edgeTypeFilter || edge.typeId === edgeTypeFilter) && visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
    );
  }, [edgeTypeFilter, graph.edges, graphNodes]);

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

  useEffect(() => {
    if (!selectedEdge) {
      return;
    }

    const edgeNodeIds = [selectedEdge.sourceNodeId, selectedEdge.targetNodeId];
    const currentNodeId = selectedNode?.id;

    if (currentNodeId && edgeNodeIds.includes(currentNodeId)) {
      if (selectedNodeId !== currentNodeId) {
        setSelectedNodeId(currentNodeId);
      }
      return;
    }

    const nextNodeId = edgeNodeIds.find(nodeId => graph.nodes.some(node => node.id === nodeId));
    if (nextNodeId && nextNodeId !== selectedNodeId) {
      setSelectedNodeId(nextNodeId);
    }
  }, [graph.nodes, selectedEdge, selectedNode?.id, selectedNodeId]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      await refresh();
      setMessage(label);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
    void saveNode(event.currentTarget);
  };

  const saveNode = async (form: HTMLFormElement, expectedVersion = graph.version) => {
    if (!selectedNode) return false;
    return run("Node updated.", () =>
      api(`/api/nodes/${selectedNode.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion,
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
          direction: edgeDirectionFormValue(form),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
    form.reset();
    setCreateEdgeFormVersion(version => version + 1);
  };

  const updateEdge = (event: FormEvent<HTMLFormElement>, edgeId: string) => {
    event.preventDefault();
    void saveEdge(event.currentTarget, edgeId);
  };

  const saveEdge = async (form: HTMLFormElement, edgeId: string, expectedVersion = graph.version) => {
    const edge = graph.edges.find(candidate => candidate.id === edgeId) ?? context?.edges.find(candidate => candidate.id === edgeId) ?? null;
    if (!edge) return false;
    return run("Edge updated.", () =>
      api(`/api/edges/${edge.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion,
          typeId: formValue(form, "typeId"),
          sourceNodeId: formValue(form, "sourceNodeId"),
          targetNodeId: formValue(form, "targetNodeId"),
          direction: edgeDirectionFormValue(form),
          description: formValue(form, "description"),
          metadata: metadataFormValue(form, "metadata"),
        }),
      }),
    );
  };

  const isNodeDirty = () => {
    if (!selectedNode || !nodeFormRef.current) {
      return false;
    }

    const form = nodeFormRef.current;
    const currentNode = {
      name: formValue(form, "name"),
      typeId: formValue(form, "typeId"),
      description: formValue(form, "description"),
      metadata: stableStringify(parseJsonObject(formValue(form, "metadata"))),
    };

    const originalNode = {
      name: selectedNode.name,
      typeId: selectedNode.typeId,
      description: selectedNode.description,
      metadata: stableStringify(selectedNode.metadata),
    };

    return JSON.stringify(currentNode) !== JSON.stringify(originalNode);
  };

  const isEdgeDirty = (edgeId: string, form: HTMLFormElement | null) => {
    const edge = graph.edges.find(candidate => candidate.id === edgeId) ?? context?.edges.find(candidate => candidate.id === edgeId) ?? null;
    if (!edge || !form) {
      return false;
    }

    const currentEdge = {
      typeId: formValue(form, "typeId"),
      sourceNodeId: formValue(form, "sourceNodeId"),
      targetNodeId: formValue(form, "targetNodeId"),
      direction: edgeDirectionFormValue(form),
      description: formValue(form, "description"),
      metadata: stableStringify(parseJsonObject(formValue(form, "metadata"))),
    };

    const originalEdge = {
      typeId: edge.typeId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      direction: edge.direction,
      description: edge.description,
      metadata: stableStringify(edge.metadata),
    };

    return JSON.stringify(currentEdge) !== JSON.stringify(originalEdge);
  };

  const getDirtyEdgeIds = () => {
    if (!context) {
      return [] as string[];
    }

    return context.edges.filter(edge => isEdgeDirty(edge.id, edgeFormRefs.current[edge.id] ?? null)).map(edge => edge.id);
  };

  const hasDirtyForms = () => isNodeDirty() || getDirtyEdgeIds().length > 0;

  const applySelection = (selection: PendingSelection) => {
    setSelectedNodeId(selection.nodeId);
    setSelectedEdgeId(selection.edgeId);
  };

  const maybeRequestSelection = (selection: PendingSelection) => {
    if (selection.nodeId === selectedNodeId && selection.edgeId === selectedEdgeId) {
      return;
    }

    if (hasDirtyForms()) {
      setPendingSelection(selection);
      return;
    }

    applySelection(selection);
  };

  const requestTabChange = (tab: EditorTab) => {
    if (tab === activeTab) {
      return;
    }

    if (hasDirtyForms()) {
      setPendingTab(tab);
      return;
    }

    setActiveTab(tab);
  };

  const resolveNodeSelectionForEdge = (edgeId: string) => {
    const edge = graph.edges.find(candidate => candidate.id === edgeId) ?? context?.edges.find(candidate => candidate.id === edgeId) ?? null;
    if (!edge) {
      return selectedNodeId;
    }

    const edgeNodeIds = [edge.sourceNodeId, edge.targetNodeId];
    if (selectedNode?.id && edgeNodeIds.includes(selectedNode.id)) {
      return selectedNode.id;
    }

    return edgeNodeIds.find(nodeId => graph.nodes.some(node => node.id === nodeId)) ?? selectedNodeId;
  };

  const handlePendingSelectionSave = async () => {
    if (!pendingSelection) {
      return;
    }

    const shouldSaveNode = isNodeDirty();
    const dirtyEdgeIds = getDirtyEdgeIds();
    let expectedVersion = graph.version;

    if (shouldSaveNode && nodeFormRef.current) {
      const saved = await saveNode(nodeFormRef.current, expectedVersion);
      if (!saved) {
        return;
      }

      expectedVersion += 1;
    }

    for (const edgeId of dirtyEdgeIds) {
      const form = edgeFormRefs.current[edgeId] ?? null;
      if (!form) {
        continue;
      }

      const saved = await saveEdge(form, edgeId, expectedVersion);
      if (!saved) {
        return;
      }

      expectedVersion += 1;
    }

    applySelection(pendingSelection);
    setPendingSelection(null);

    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handlePendingSelectionDiscard = () => {
    if (pendingSelection) {
      applySelection(pendingSelection);
      setPendingSelection(null);
    }

    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
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
              Manage flexible entities, relationship types, metadata, and realtime graph updates from one deterministic UI.
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
            onSelectNode={id => {
              maybeRequestSelection({ nodeId: id, edgeId: "" });
            }}
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
                  onClick={() => maybeRequestSelection({ nodeId: node.id, edgeId: "" })}
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

        <div>
          <Panel title="Graph editor">
            <div className="mb-5 flex flex-wrap gap-2">
              <TabButton active={activeTab === "current"} onClick={() => requestTabChange("current")}>
                Current
              </TabButton>
              <TabButton active={activeTab === "new-node"} onClick={() => requestTabChange("new-node")}>
                New node
              </TabButton>
              <TabButton active={activeTab === "new-edge"} onClick={() => requestTabChange("new-edge")}>
                New edge
              </TabButton>
              <TabButton active={activeTab === "types"} onClick={() => requestTabChange("types")}>
                Types
              </TabButton>
            </div>

            {activeTab === "current" && (
              selectedNode && context ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">{selectedNode.name}</h2>
                    <p className="text-sm text-violet-200">{selectedNode.typeId}</p>
                    <p className="mt-2 text-sm text-zinc-300">{selectedNode.description || "No description."}</p>
                  </div>
                  <form key={selectedNode.id} ref={nodeFormRef} onSubmit={updateNode}>
                    <h3 className="font-semibold">Edit node</h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <select name="typeId" defaultValue={selectedNode.typeId} required className="w-auto max-w-full flex-none">
                        {graph.nodeTypes.map(type => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                      <input name="name" defaultValue={selectedNode.name} placeholder="Name" required className="min-w-56 flex-1" />
                    </div>
                    <textarea name="description" defaultValue={selectedNode.description} placeholder="Description" />
                    <MetadataEditor name="metadata" initialMetadata={selectedNode.metadata} />
                    <div className="flex flex-wrap gap-2">
                      <button>Save node changes</button>
                      <button type="button" className="danger" onClick={() => void deleteNode(selectedNode.id)}>
                        Delete node
                      </button>
                    </div>
                  </form>
                  <div className="space-y-3">
                    <h3 className="font-semibold">Connections</h3>
                    {context.edges.length > 0 ? (
                      context.edges.map(edge => (
                        <div
                          className={edge.id === selectedEdge?.id ? "rounded-lg border border-violet-400/40 bg-violet-950/10 p-3 text-sm" : "rounded-lg border border-zinc-800 p-3 text-sm"}
                          key={edge.id}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <strong>{edge.typeId}</strong> · {edge.sourceNodeId} {edge.direction === "directed" ? "->" : "<->"} {edge.targetNodeId}
                            </div>
                            <small>ID: {edge.id}</small>
                          </div>
                          <form
                            key={edge.id}
                            ref={form => {
                              edgeFormRefs.current[edge.id] = form;
                            }}
                            onSubmit={event => updateEdge(event, edge.id)}
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <select name="sourceNodeId" defaultValue={edge.sourceNodeId} required className="w-auto max-w-full flex-none">
                                <option value="">Origin</option>
                                {graph.nodes.map(node => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))}
                              </select>
                              <select name="typeId" defaultValue={edge.typeId} required className="w-auto max-w-full flex-none">
                                <option value="">Type</option>
                                {graph.edgeTypes.map(type => (
                                  <option key={type.id} value={type.id}>
                                    {type.name}
                                  </option>
                                ))}
                              </select>
                              <select name="targetNodeId" defaultValue={edge.targetNodeId} required className="w-auto max-w-full flex-none">
                                <option value="">Target</option>
                                {graph.nodes.map(node => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))}
                              </select>
                              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                                <input
                                  type="checkbox"
                                  name="bidirectional"
                                  defaultChecked={edge.direction === "bidirectional"}
                                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                                />
                                Bidirectional
                              </label>
                            </div>
                            <textarea name="description" defaultValue={edge.description} placeholder="Description" />
                            <MetadataEditor name="metadata" initialMetadata={edge.metadata} />
                            <div className="flex flex-wrap gap-2">
                              <button>Save edge changes</button>
                              <button type="button" className="danger" onClick={() => void deleteEdge(edge.id)}>
                                Delete edge
                              </button>
                            </div>
                          </form>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-400">This node has no direct connections yet.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-400">Create or select a node to inspect and edit it here.</p>
              )
            )}

            {activeTab === "new-node" && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">Create a node and attach metadata using the currently available node types.</p>
                <form key={createNodeFormVersion} onSubmit={createNode}>
                  <input name="id" placeholder="optional-id" />
                  <div className="flex flex-wrap items-center gap-3">
                    <select name="typeId" required className="w-auto max-w-full flex-none">
                      <option value="">Type</option>
                      {graph.nodeTypes.map(type => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                    <input name="name" placeholder="Name" required className="min-w-56 flex-1" />
                  </div>
                  <textarea name="description" placeholder="Description" />
                  <MetadataEditor name="metadata" />
                  <button>Create node</button>
                </form>
              </div>
            )}

            {activeTab === "new-edge" && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">Create an edge between existing nodes with a selected edge type.</p>
                <form key={createEdgeFormVersion} onSubmit={createEdge}>
                  <input name="id" placeholder="optional-id" />
                  <div className="flex flex-wrap items-center gap-3">
                    <select name="sourceNodeId" required className="w-auto max-w-full flex-none">
                      <option value="">Origin</option>
                      {graph.nodes.map(node => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                    <select name="typeId" required className="w-auto max-w-full flex-none">
                      <option value="">Type</option>
                      {graph.edgeTypes.map(type => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                    <select name="targetNodeId" required className="w-auto max-w-full flex-none">
                      <option value="">Target</option>
                      {graph.nodes.map(node => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                      <input type="checkbox" name="bidirectional" className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
                      Bidirectional
                    </label>
                  </div>
                  <textarea name="description" placeholder="Description" />
                  <MetadataEditor name="metadata" />
                  <button>Create edge</button>
                </form>
              </div>
            )}

            {activeTab === "types" && (
              <div className="grid gap-5 xl:grid-cols-2">
                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <form onSubmit={createNodeType}>
                      <h3 className="font-semibold">New node type</h3>
                      <input name="id" placeholder="optional-id" />
                      <input name="name" placeholder="Name" required />
                      <textarea name="description" placeholder="Description" />
                      <textarea name="metadataSchema" placeholder='Schema JSON, e.g. {"status":{"type":"string"}}' />
                      <button>Create node type</button>
                    </form>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <form onSubmit={createEdgeType}>
                      <h3 className="font-semibold">New edge type</h3>
                      <input name="id" placeholder="optional-id" />
                      <input name="name" placeholder="Name" required />
                      <textarea name="description" placeholder="Description" />
                      <textarea name="metadataSchema" placeholder='Schema JSON, e.g. {"confidence":{"type":"number"}}' />
                      <button>Create edge type</button>
                    </form>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <h3 className="mb-3 font-semibold">Manage node types</h3>
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
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <h3 className="mb-3 font-semibold">Manage edge types</h3>
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
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
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

        {(pendingSelection || pendingTab) && (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
            <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl shadow-black/40">
              <h2 className="text-lg font-semibold">Unsaved changes</h2>
              <p className="mt-2 text-sm text-zinc-300">You have unsaved node or edge edits. Save them before switching selection?</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSelection(null);
                    setPendingTab(null);
                  }}
                >
                  Keep editing
                </button>
                <button type="button" className="danger" onClick={handlePendingSelectionDiscard}>
                  Discard
                </button>
                <button type="button" onClick={() => void handlePendingSelectionSave()}>
                  Save
                </button>
              </div>
            </div>
          </section>
        )}
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

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={props.active ? "tab active" : "tab"} onClick={props.onClick}>
      {props.children}
    </button>
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
      return {
        serializedValue: JSON.stringify({ __metadataEditorInvalid: true, entries }),
        error: err instanceof Error ? err.message : String(err),
      };
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
          <button
            type="button"
            onClick={addEntry}
            className="inline-flex h-8 w-8 items-center justify-center p-0 text-lg leading-none"
            aria-label="Add property"
            title="Add property"
          >
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

const typeColorPalette = Array.from({ length: 128 }, (_, index) => {
  const hue = (index * 47) % 360;
  const saturation = 52 + ((index * 29) % 18);
  const lightness = 42 + ((index * 31) % 16);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
});

function colorForTypeName(typeName: string): string {
  const normalizedName = typeName.trim().toLowerCase() || "unknown";
  let hash = 2166136261;

  for (const character of normalizedName) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return typeColorPalette[(hash >>> 0) % typeColorPalette.length];
}

function GraphMap(props: {
  graph: GraphSnapshot;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}) {
  const selectedNodeFill = "#f59e0b";
  const selectedNodeStroke = "#fde68a";
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; hasDragged: boolean } | null>(null);
  const nodeTypeNames = new Map(props.graph.nodeTypes.map(nodeType => [nodeType.id, nodeType.name]));
  const edgeTypeNames = new Map(props.graph.edgeTypes.map(edgeType => [edgeType.id, edgeType.name]));
  const layout = useMemo(
    () =>
      layoutGraph(
        props.graph.nodes.map(node => ({ id: node.id })),
        props.graph.edges.map(edge => ({ sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })),
      ),
    [props.graph.edges, props.graph.nodes],
  );
  const positions = layout.positions;
  const viewBox = `${layout.bounds.minX} ${layout.bounds.minY} ${layout.bounds.width} ${layout.bounds.height}`;
  const showNodeLabels = props.graph.nodes.length <= 90 || scale >= 1.2;
  const showEdgeLabels = props.graph.edges.length <= 60 || scale >= 1.4;

  const clampScale = (nextScale: number) => Math.min(3, Math.max(0.5, nextScale));

  const zoomIn = () => {
    setScale(current => clampScale(current * 1.1));
  };

  const zoomOut = () => {
    setScale(current => clampScale(current * 0.9));
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
        <p>Drag to pan. Reset returns to the fitted graph view.</p>
        <button type="button" onClick={handleResetViewport}>
          Reset view
        </button>
      </div>
      <div className="relative">
        <svg
          viewBox={viewBox}
          className="h-[440px] w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
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
              const label = edgeTypeNames.get(edge.typeId) ?? edge.typeId;
              const edgeColor = colorForTypeName(label);
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2;
              const labelWidth = Math.min(label.length * 7 + 16, 180);
              return (
                <g key={edge.id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edgeColor}
                    strokeWidth="14"
                    opacity="0"
                    pointerEvents="none"
                  />
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edgeColor}
                    strokeWidth="2"
                    opacity="0.78"
                    pointerEvents="none"
                  />
                  {showEdgeLabels && (
                    <>
                      <rect
                        x={midX - labelWidth / 2}
                        y={midY - 18}
                        width={labelWidth}
                        height={18}
                        rx="4"
                        fill={edgeColor}
                        opacity="0.2"
                        pointerEvents="none"
                      />
                      <text x={midX} y={midY - 6} textAnchor="middle" fill="#e4e4e7" fontSize="10" pointerEvents="none">
                        {label}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            {props.graph.nodes.map(node => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selected = node.id === props.selectedNodeId;
              const nodeTypeName = nodeTypeNames.get(node.typeId) ?? node.typeId;
              const nodeColor = colorForTypeName(nodeTypeName);
              const label = node.name.slice(0, 18);
              const labelWidth = Math.min(label.length * 7 + 12, 140);
              return (
                <g key={node.id} className="cursor-pointer">
                  <circle cx={position.x} cy={position.y} r={30} fill="transparent" pointerEvents="all" onClick={() => props.onSelectNode(node.id)} />
                  <circle
                    cx={position.x}
                    cy={position.y}
                    r={selected ? 25 : 20}
                    fill={selected ? selectedNodeFill : nodeColor}
                    stroke={selected ? selectedNodeStroke : "rgba(244, 244, 245, 0.2)"}
                    strokeWidth={selected ? 3 : 1.5}
                    onClick={() => props.onSelectNode(node.id)}
                  />
                  {showNodeLabels && (
                    <>
                      <rect
                        x={position.x - labelWidth / 2}
                        y={position.y + 24}
                        width={labelWidth}
                        height={20}
                        fill="rgba(9, 9, 11, 0.78)"
                        rx="4"
                        pointerEvents="all"
                        onClick={() => props.onSelectNode(node.id)}
                      />
                      <text x={position.x} y={position.y + 36} textAnchor="middle" fill="#e4e4e7" fontSize="11" pointerEvents="none">
                        {label}
                      </text>
                    </>
                  )}
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
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button type="button" className="h-10 w-10 p-0 text-xl leading-none" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
            +
          </button>
          <button type="button" className="h-10 w-10 p-0 text-xl leading-none" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
            -
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
