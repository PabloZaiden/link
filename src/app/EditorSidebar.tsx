import type { FormEvent, MutableRefObject, ReactNode, RefObject } from "react";
import { MetadataEditor, TabButton } from "./components";
import type { EditorTab, GraphContext, GraphEdge, GraphNode, GraphSnapshot, Metadata, TypeDefinition } from "./types";

interface EditorSidebarProps {
  activeTab: EditorTab;
  context: GraphContext | null;
  createEdgeFormVersion: number;
  createNodeFormVersion: number;
  editorSidebarOpen: boolean;
  edgeFormRefs: MutableRefObject<Record<string, HTMLFormElement | null>>;
  graph: GraphSnapshot;
  onCreateEdge: (event: FormEvent<HTMLFormElement>) => void;
  onCreateEdgeType: (event: FormEvent<HTMLFormElement>) => void;
  onCreateNode: (event: FormEvent<HTMLFormElement>) => void;
  onCreateNodeType: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteEdge: (id: string) => void;
  onDeleteEdgeType: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteNodeType: (id: string) => void;
  onRequestTabChange: (tab: EditorTab) => void;
  onSelectEdgeTypeId: (id: string) => void;
  onSelectNodeTypeId: (id: string) => void;
  onUpdateEdge: (event: FormEvent<HTMLFormElement>, edgeId: string) => void;
  onUpdateEdgeType: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateNode: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateNodeType: (event: FormEvent<HTMLFormElement>) => void;
  nodeFormRef: RefObject<HTMLFormElement | null>;
  selectedEdge: GraphEdge | null;
  selectedEdgeType: TypeDefinition | null;
  selectedNode: GraphNode | null;
  selectedNodeType: TypeDefinition | null;
  setEditorSidebarOpenToggle?: ReactNode;
}

function DirectionToggle(props: { checked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
      <input
        type="checkbox"
        name="bidirectional"
        defaultChecked={props.checked}
        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
      />
      Bidirectional
    </label>
  );
}

function NodeTypeOptions(props: { nodeTypes: TypeDefinition[] }) {
  return (
    <>
      {props.nodeTypes.map(type => (
        <option key={type.id} value={type.id}>
          {type.name}
        </option>
      ))}
    </>
  );
}

function EdgeTypeOptions(props: { edgeTypes: TypeDefinition[] }) {
  return (
    <>
      {props.edgeTypes.map(type => (
        <option key={type.id} value={type.id}>
          {type.name}
        </option>
      ))}
    </>
  );
}

function NodeOptions(props: { nodes: GraphNode[] }) {
  return (
    <>
      {props.nodes.map(node => (
        <option key={node.id} value={node.id}>
          {node.name}
        </option>
      ))}
    </>
  );
}

function JsonTextarea(props: { name: string; defaultValue?: Metadata | Record<string, unknown> }) {
  return <textarea name={props.name} defaultValue={JSON.stringify(props.defaultValue ?? {}, null, 2)} placeholder="Metadata schema JSON" />;
}

export function EditorSidebar(props: EditorSidebarProps) {
  return (
    <aside
      id="graph-editor-sidebar"
      className={props.editorSidebarOpen
        ? "fixed bottom-6 right-6 top-20 z-40 w-[min(32rem,calc(100vw-3rem))] translate-x-0 opacity-100 transition-all duration-300 ease-out"
        : "pointer-events-none fixed bottom-6 right-6 top-20 z-40 w-[min(32rem,calc(100vw-3rem))] translate-x-[calc(100%+1.5rem)] opacity-0 transition-all duration-300 ease-out"}
      aria-hidden={!props.editorSidebarOpen}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="border-b border-zinc-800 p-5">
          <h2 className="text-lg font-semibold">Graph editor</h2>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            <TabButton active={props.activeTab === "current"} onClick={() => props.onRequestTabChange("current")}>
              Current
            </TabButton>
            <TabButton active={props.activeTab === "new-node"} onClick={() => props.onRequestTabChange("new-node")}>
              New node
            </TabButton>
            <TabButton active={props.activeTab === "new-edge"} onClick={() => props.onRequestTabChange("new-edge")}>
              New edge
            </TabButton>
            <TabButton active={props.activeTab === "types"} onClick={() => props.onRequestTabChange("types")}>
              Types
            </TabButton>
          </div>

          {props.activeTab === "current" && (
            props.selectedNode && props.context ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">{props.selectedNode.name}</h2>
                  <p className="text-sm text-violet-200">{props.selectedNode.typeId}</p>
                  <p className="mt-2 text-sm text-zinc-300">{props.selectedNode.description || "No description."}</p>
                </div>
                <form key={props.selectedNode.id} ref={props.nodeFormRef} onSubmit={props.onUpdateNode}>
                  <h3 className="font-semibold">Edit node</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <select name="typeId" defaultValue={props.selectedNode.typeId} required className="w-auto max-w-full flex-none">
                      <NodeTypeOptions nodeTypes={props.graph.nodeTypes} />
                    </select>
                    <input name="name" defaultValue={props.selectedNode.name} placeholder="Name" required className="min-w-56 flex-1" />
                  </div>
                  <textarea name="description" defaultValue={props.selectedNode.description} placeholder="Description" />
                  <MetadataEditor name="metadata" initialMetadata={props.selectedNode.metadata} />
                  <div className="flex flex-wrap gap-2">
                    <button>Save node changes</button>
                    <button type="button" className="danger" onClick={() => props.onDeleteNode(props.selectedNode!.id)}>
                      Delete node
                    </button>
                  </div>
                </form>
                <div className="space-y-3">
                  <h3 className="font-semibold">Connections</h3>
                  {props.context.edges.length > 0 ? (
                    props.context.edges.map(edge => (
                      <div
                        className={edge.id === props.selectedEdge?.id ? "rounded-lg border border-violet-400/40 bg-violet-950/10 p-3 text-sm" : "rounded-lg border border-zinc-800 p-3 text-sm"}
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
                            props.edgeFormRefs.current[edge.id] = form;
                          }}
                          onSubmit={event => props.onUpdateEdge(event, edge.id)}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <select name="sourceNodeId" defaultValue={edge.sourceNodeId} required className="w-auto max-w-full flex-none">
                              <option value="">Origin</option>
                              <NodeOptions nodes={props.graph.nodes} />
                            </select>
                            <select name="typeId" defaultValue={edge.typeId} required className="w-auto max-w-full flex-none">
                              <option value="">Type</option>
                              <EdgeTypeOptions edgeTypes={props.graph.edgeTypes} />
                            </select>
                            <select name="targetNodeId" defaultValue={edge.targetNodeId} required className="w-auto max-w-full flex-none">
                              <option value="">Target</option>
                              <NodeOptions nodes={props.graph.nodes} />
                            </select>
                            <DirectionToggle checked={edge.direction === "bidirectional"} />
                          </div>
                          <textarea name="description" defaultValue={edge.description} placeholder="Description" />
                          <MetadataEditor name="metadata" initialMetadata={edge.metadata} />
                          <div className="flex flex-wrap gap-2">
                            <button>Save edge changes</button>
                            <button type="button" className="danger" onClick={() => props.onDeleteEdge(edge.id)}>
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

          {props.activeTab === "new-node" && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">Create a node and attach metadata using the currently available node types.</p>
              <form key={props.createNodeFormVersion} onSubmit={props.onCreateNode}>
                <input name="id" placeholder="optional-id" />
                <div className="flex flex-wrap items-center gap-3">
                  <select name="typeId" required className="w-auto max-w-full flex-none">
                    <option value="">Type</option>
                    <NodeTypeOptions nodeTypes={props.graph.nodeTypes} />
                  </select>
                  <input name="name" placeholder="Name" required className="min-w-56 flex-1" />
                </div>
                <textarea name="description" placeholder="Description" />
                <MetadataEditor name="metadata" />
                <button>Create node</button>
              </form>
            </div>
          )}

          {props.activeTab === "new-edge" && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">Create an edge between existing nodes with a selected edge type.</p>
              <form key={props.createEdgeFormVersion} onSubmit={props.onCreateEdge}>
                <input name="id" placeholder="optional-id" />
                <div className="flex flex-wrap items-center gap-3">
                  <select name="sourceNodeId" required className="w-auto max-w-full flex-none">
                    <option value="">Origin</option>
                    <NodeOptions nodes={props.graph.nodes} />
                  </select>
                  <select name="typeId" required className="w-auto max-w-full flex-none">
                    <option value="">Type</option>
                    <EdgeTypeOptions edgeTypes={props.graph.edgeTypes} />
                  </select>
                  <select name="targetNodeId" required className="w-auto max-w-full flex-none">
                    <option value="">Target</option>
                    <NodeOptions nodes={props.graph.nodes} />
                  </select>
                  <DirectionToggle />
                </div>
                <textarea name="description" placeholder="Description" />
                <MetadataEditor name="metadata" />
                <button>Create edge</button>
              </form>
            </div>
          )}

          {props.activeTab === "types" && (
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-5">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <form onSubmit={props.onCreateNodeType}>
                    <h3 className="font-semibold">New node type</h3>
                    <input name="id" placeholder="optional-id" />
                    <input name="name" placeholder="Name" required />
                    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                      <input type="checkbox" name="immutable" className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
                      Immutable nodes
                    </label>
                    <textarea name="description" placeholder="Description" />
                    <textarea name="metadataSchema" placeholder='Schema JSON, e.g. {"status":{"type":"string"}}' />
                    <button>Create node type</button>
                  </form>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <form onSubmit={props.onCreateEdgeType}>
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
                  <select value={props.selectedNodeType?.id ?? ""} onChange={event => props.onSelectNodeTypeId(event.target.value)}>
                    <NodeTypeOptions nodeTypes={props.graph.nodeTypes} />
                  </select>
                  {props.selectedNodeType ? (
                    <form key={props.selectedNodeType.id} className="mt-3" onSubmit={props.onUpdateNodeType}>
                      <small>ID: {props.selectedNodeType.id}</small>
                      <input name="name" defaultValue={props.selectedNodeType.name} placeholder="Name" required />
                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                        <input type="checkbox" name="immutable" defaultChecked={props.selectedNodeType.immutable === true} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
                        Immutable nodes
                      </label>
                      <textarea name="description" defaultValue={props.selectedNodeType.description} placeholder="Description" />
                      <JsonTextarea name="metadataSchema" defaultValue={props.selectedNodeType.metadataSchema} />
                      <div className="flex flex-wrap gap-2">
                        <button>Save node type changes</button>
                        <button type="button" className="danger" onClick={() => props.onDeleteNodeType(props.selectedNodeType!.id)}>
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
                  <select value={props.selectedEdgeType?.id ?? ""} onChange={event => props.onSelectEdgeTypeId(event.target.value)}>
                    <EdgeTypeOptions edgeTypes={props.graph.edgeTypes} />
                  </select>
                  {props.selectedEdgeType ? (
                    <form key={props.selectedEdgeType.id} className="mt-3" onSubmit={props.onUpdateEdgeType}>
                      <small>ID: {props.selectedEdgeType.id}</small>
                      <input name="name" defaultValue={props.selectedEdgeType.name} placeholder="Name" required />
                      <textarea name="description" defaultValue={props.selectedEdgeType.description} placeholder="Description" />
                      <JsonTextarea name="metadataSchema" defaultValue={props.selectedEdgeType.metadataSchema} />
                      <div className="flex flex-wrap gap-2">
                        <button>Save edge type changes</button>
                        <button type="button" className="danger" onClick={() => props.onDeleteEdgeType(props.selectedEdgeType!.id)}>
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
        </div>
      </div>
    </aside>
  );
}