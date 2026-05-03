import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./index.css";
import { EditorSidebar } from "./app/EditorSidebar";
import { GraphMap } from "./app/GraphMap";
import { Panel, TypeFilterControl } from "./app/components";
import type { EditorTab, GraphContext, GraphEdge, GraphNode, GraphSnapshot, PendingSelection } from "./app/types";
import { emptyGraph } from "./app/types";
import { api, edgeDirectionFormValue, formValue, metadataFormValue, parseJsonObject, stableStringify } from "./app/utils";

export function App() {
  const [graph, setGraph] = useState<GraphSnapshot>(emptyGraph);
  const [createNodeFormVersion, setCreateNodeFormVersion] = useState(0);
  const [createEdgeFormVersion, setCreateEdgeFormVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<EditorTab>("current");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [context, setContext] = useState<GraphContext | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [nodeTypeFilterIds, setNodeTypeFilterIds] = useState<string[]>([]);
  const [edgeTypeFilterIds, setEdgeTypeFilterIds] = useState<string[]>([]);
  const [selectedNodeTypeId, setSelectedNodeTypeId] = useState("");
  const [selectedEdgeTypeId, setSelectedEdgeTypeId] = useState("");
  const [editorSidebarOpen, setEditorSidebarOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [pendingTab, setPendingTab] = useState<EditorTab | null>(null);
  const nodeFormRef = useRef<HTMLFormElement | null>(null);
  const edgeFormRefs = useRef<Record<string, HTMLFormElement | null>>({});

  const selectedNode = graph.nodes.find(node => node.id === selectedNodeId) ?? null;
  const selectedEdge = selectedEdgeId
    ? graph.edges.find(edge => edge.id === selectedEdgeId) ?? context?.edges.find(edge => edge.id === selectedEdgeId) ?? null
    : null;
  const selectedNodeType = graph.nodeTypes.find(type => type.id === selectedNodeTypeId) ?? graph.nodeTypes[0] ?? null;
  const selectedEdgeType = graph.edgeTypes.find(type => type.id === selectedEdgeTypeId) ?? graph.edgeTypes[0] ?? null;
  const nodeSearchMatches = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) {
      return [] as GraphNode[];
    }

    return graph.nodes.filter(node => JSON.stringify(node).toLowerCase().includes(needle)).slice(0, 12);
  }, [graph.nodes, search]);

  const refresh = async () => {
    const nextGraph = await api<GraphSnapshot>("/api/graph");
    setGraph(nextGraph);
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
  }, [selectedNode?.id, graph]);

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
    if (selectedNodeId && !graph.nodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [graph.edgeTypes, graph.edges, graph.nodeTypes, graph.nodes, selectedEdgeId, selectedEdgeTypeId, selectedNodeId, selectedNodeTypeId]);

  useEffect(() => {
    const validNodeTypeIds = new Set(graph.nodeTypes.map(type => type.id));
    const validEdgeTypeIds = new Set(graph.edgeTypes.map(type => type.id));

    setNodeTypeFilterIds(current => current.filter(typeId => validNodeTypeIds.has(typeId)));
    setEdgeTypeFilterIds(current => current.filter(typeId => validEdgeTypeIds.has(typeId)));
  }, [graph.edgeTypes, graph.nodeTypes]);

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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const createNodeType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run("Node type created.", () =>
      api("/api/node-types", {
        method: "POST",
        body: JSON.stringify({
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

  const saveNode = async (form: HTMLFormElement) => {
    if (!selectedNode) return false;
    return run("Node updated.", () =>
      api(`/api/nodes/${selectedNode.id}`, {
        method: "PUT",
        body: JSON.stringify({
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

  const saveEdge = async (form: HTMLFormElement, edgeId: string) => {
    const edge = graph.edges.find(candidate => candidate.id === edgeId) ?? context?.edges.find(candidate => candidate.id === edgeId) ?? null;
    if (!edge) return false;
    return run("Edge updated.", () =>
      api(`/api/edges/${edge.id}`, {
        method: "PUT",
        body: JSON.stringify({
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
    if (shouldSaveNode && nodeFormRef.current) {
      const saved = await saveNode(nodeFormRef.current);
      if (!saved) {
        return;
      }
    }

    for (const edgeId of dirtyEdgeIds) {
      const form = edgeFormRefs.current[edgeId] ?? null;
      if (!form) {
        continue;
      }

      const saved = await saveEdge(form, edgeId);
      if (!saved) {
        return;
      }
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
    run("Node deleted.", () => api(`/api/nodes/${id}`, { method: "DELETE" }));

  const deleteEdge = (id: string) =>
    run("Edge deleted.", () => api(`/api/edges/${id}`, { method: "DELETE" }));

  const deleteNodeType = (id: string) =>
    run("Node type deleted.", () => api(`/api/node-types/${id}`, { method: "DELETE" }));

  const deleteEdgeType = (id: string) =>
    run("Edge type deleted.", () => api(`/api/edge-types/${id}`, { method: "DELETE" }));

  return (
    <main className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex-none border-b border-zinc-800 bg-zinc-900/80 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-violet-300">Link</p>
          <button
            type="button"
            onClick={() => setEditorSidebarOpen(current => !current)}
            aria-expanded={editorSidebarOpen}
            aria-controls="graph-editor-sidebar"
            aria-label={editorSidebarOpen ? "Hide graph editor" : "Show graph editor"}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2 4.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M2 9H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M2 13.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {error && <p className="rounded-lg border border-violet-500/20 bg-zinc-900 p-3 text-sm text-zinc-200">{error}</p>}

        <Panel className="flex min-h-0 flex-1 flex-col">
          {filtersOpen && (
            <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="graph-search">
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search nodes..." />
                {search.trim() && (
                  <div className="graph-search__results">
                    {nodeSearchMatches.length === 0 ? (
                      <p className="graph-search__empty">No matching nodes.</p>
                    ) : (
                      nodeSearchMatches.map(node => (
                        <button
                          type="button"
                          key={node.id}
                          className={node.id === selectedNode?.id ? "item selected" : "item"}
                          onClick={() => {
                            maybeRequestSelection({ nodeId: node.id, edgeId: "" });
                            setSearch("");
                          }}
                        >
                          <span>
                            <strong>{node.name}</strong>
                            <small>{node.typeId}</small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <TypeFilterControl
                label="Node types"
                allLabel="All node types"
                options={graph.nodeTypes}
                selectedIds={nodeTypeFilterIds}
                onChange={setNodeTypeFilterIds}
              />
              <TypeFilterControl
                label="Edge types"
                allLabel="All edge types"
                options={graph.edgeTypes}
                selectedIds={edgeTypeFilterIds}
                onChange={setEdgeTypeFilterIds}
              />
            </div>
          )}
          <GraphMap
            graph={graph}
            selectedNodeId={selectedNode?.id ?? ""}
            selectedNodeTypeFilterIds={nodeTypeFilterIds}
            selectedEdgeTypeFilterIds={edgeTypeFilterIds}
            onSelectNode={id => {
              maybeRequestSelection({ nodeId: id, edgeId: "" });
            }}
            onClearSelection={() => {
              maybeRequestSelection({ nodeId: "", edgeId: "" });
            }}
            controls={
              <button
                type="button"
                className="bg-zinc-950/95 shadow-lg shadow-black/30 backdrop-blur"
                onClick={() => setFiltersOpen(current => !current)}
                aria-expanded={filtersOpen}
                aria-label={filtersOpen ? "Hide search and filters" : "Show search and filters"}
              >
                {filtersOpen ? "Hide filters" : "Show filters"}
              </button>
            }
          />
        </Panel>

        <EditorSidebar
          activeTab={activeTab}
          context={context}
          createEdgeFormVersion={createEdgeFormVersion}
          createNodeFormVersion={createNodeFormVersion}
          editorSidebarOpen={editorSidebarOpen}
          edgeFormRefs={edgeFormRefs}
          graph={graph}
          nodeFormRef={nodeFormRef}
          onCreateEdge={createEdge}
          onCreateEdgeType={createEdgeType}
          onCreateNode={createNode}
          onCreateNodeType={createNodeType}
          onDeleteEdge={id => {
            void deleteEdge(id);
          }}
          onDeleteEdgeType={id => {
            void deleteEdgeType(id);
          }}
          onDeleteNode={id => {
            void deleteNode(id);
          }}
          onDeleteNodeType={id => {
            void deleteNodeType(id);
          }}
          onRequestTabChange={requestTabChange}
          onSelectEdgeTypeId={setSelectedEdgeTypeId}
          onSelectNodeTypeId={setSelectedNodeTypeId}
          onUpdateEdge={updateEdge}
          onUpdateEdgeType={updateEdgeType}
          onUpdateNode={updateNode}
          onUpdateNodeType={updateNodeType}
          selectedEdge={selectedEdge}
          selectedEdgeType={selectedEdgeType}
          selectedNode={selectedNode}
          selectedNodeType={selectedNodeType}
        />

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

export default App;
