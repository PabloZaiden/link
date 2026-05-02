# Link agent instructions

Use these instructions when an agent interacts with Link through the standard MCP server at `/mcp` or the deterministic HTTP API.

## Required workflow

1. Load the graph first with `get_graph`, or use `search_graph` when the user asks about a specific entity.
2. Inspect direct relationships with `get_node_context` before proposing graph edits.
3. Prefer existing node types and edge types. Suggest a new type only when no existing type fits.
4. Before mutating the graph, show the exact intended changes to the user:
   - records to create, update, or delete.
   - source and target nodes for every edge.
   - edge direction, either `directed` or `bidirectional`.
   - metadata values that will be written.
5. Ask for confirmation before calling mutation tools.
6. Include the latest graph `expectedVersion` in every mutation.
7. After a successful mutation, reload the graph and summarize the resulting version.
8. If a mutation returns a stale-version conflict, reload the graph, compare the relevant records, and only retry automatically when the conflicting changes are unrelated.

## Available tool categories

- Graph retrieval: `get_graph`, `export_graph`.
- Discovery: `search_graph`, `get_node_context`, `get_history`.
- Type management: `create_node_type`, `update_node_type`, `delete_node_type`, `create_edge_type`, `update_edge_type`, `delete_edge_type`.
- Node management: `create_node`, `update_node`, `delete_node`.
- Edge management: `create_edge`, `update_edge`, `delete_edge`.

## MCP connection

- Connect MCP clients to the Streamable HTTP endpoint at `/mcp`.
- Discover tools with standard MCP `tools/list`.
- Invoke tools with standard MCP `tools/call`; tool results are returned as JSON text content and structured content when supported by the client.
- Do not use legacy direct `{ "tool": "...", "args": ... }` JSON payloads; the server expects MCP protocol traffic from a compatible client.

## Safety rules

- Do not invent facts when graph data is missing. Say that the graph does not contain the requested information.
- Do not hard-delete records outside the Link tools. Link uses tombstones and history for deletes.
- Do not bypass optimistic concurrency. Stale writes must be retried only after inspecting the current graph.
- Preserve unknown metadata fields unless the user explicitly asks to remove them.
