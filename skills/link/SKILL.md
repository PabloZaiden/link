---
name: link
description: Use Link through MCP when connected, or through link-cli when MCP is unavailable, to inspect, query, and safely update local knowledge graphs of typed nodes, edges, and metadata.
compatibility: Prefer a running Link MCP Streamable HTTP endpoint at /mcp, usually http://localhost:3000/mcp. If MCP is unavailable, use the link-cli binary against the same local graph data.
---

# Link

Use this skill when an agent needs to interact with a Link knowledge graph through the standard MCP server. If the MCP server connection is unavailable, use the deterministic `link-cli graph` fallback.

## Required workflow

1. Load the graph first with `get_graph`, or use `search_graph` when the user asks about a specific entity.
1. Inspect direct relationships with `get_node_context` before proposing graph edits.
1. Prefer existing node types and edge types. Suggest a new type only when no existing type fits.
1. Before mutating the graph, show the exact intended changes to the user: records to create, update, or delete; source and target nodes for edges; edge direction; and metadata values.
1. Ask for confirmation before calling mutation tools.
1. After a successful mutation, reload the graph and summarize the changed records.
1. If validation fails because of a broken reference or merge conflict, report the exact file path and ask the user to resolve the Git conflict or choose the intended graph relationship.

## Tool selection

1. If an MCP server connection is available, use MCP tools directly.
1. If MCP is not connected or unavailable, use `link-cli graph <tool_name>` with the same canonical MCP tool names.
1. For full input parity in CLI mode, pass the MCP-compatible input object with `--json`.
1. CLI graph results are JSON on stdout; parse that JSON before reasoning about the graph.

## Tool categories

- Graph retrieval: `get_graph`.
- Discovery: `search_graph`, `get_node_context`.
- Type management: `create_node_type`, `update_node_type`, `delete_node_type`, `create_edge_type`, `update_edge_type`, `delete_edge_type`.
- Node management: `create_node`, `update_node`, `delete_node`.
- Edge management: `create_edge`, `update_edge`, `delete_edge`.

## MCP connection

- Connect MCP clients to the Streamable HTTP endpoint. By default, it should be at `http://localhost:3000/mcp`.
- Discover tools with standard MCP `tools/list`.

## CLI fallback

Use the CLI only when MCP is unavailable:

```bash
link-cli graph
link-cli graph get_graph
link-cli graph search_graph --query "Ada"
link-cli graph create_node --json '{"name":"Ada Lovelace","typeId":"person"}'
```

Run `link-cli graph <tool_name> --help` to inspect the arguments for one tool. Use `link-cli validate` to validate graph JSON and `link-cli seed` to create default types when the graph is empty.

## Safety rules

- Do not invent facts when graph data is missing. Say that the graph does not contain the requested information.
- Preserve unknown metadata fields unless the user explicitly asks to remove them.

## Status updates


- Use the `status-update` node type for dated updates about one or many graph entities (a person, organization, or other entity and potentially other related entities).
- A status update must include metadata `date` in `YYYY-MM-DD` format.
- Connect each status update to the things it describes with directed `status-for` edges from the status update node to the target nodes.
- Status update nodes are immutable. Do not call `update_node` for an existing `status-update`; create a new status update node for each later update.
- To answer status or timeline questions, search for the target nodes, inspect their context, select connected `status-update` nodes through `status-for` edges, and sort them by metadata `date`.
