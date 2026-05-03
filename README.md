# Link

Link is a local-first Bun + React graph tracker for flexible work-related entities and relationships. Graph data is stored as canonical, Git-friendly JSON files under `./data/graph`; Git is the history, collaboration, backup, and conflict-resolution layer.

## Features

- Dynamic node types and edge types.
- Directed and bidirectional edges.
- Metadata schemas for declared fields, while preserving unknown metadata fields.
- One JSON file per graph record with slug IDs mapped directly to file names.
- Automatic bootstrap of default node and edge types on first run.
- Deterministic HTTP APIs, realtime WebSocket refresh, and local-only MCP tools.
- Validation CLI for catching malformed JSON, merge conflicts, and broken references.

## Local development

```bash
bun install
bun run dev
```

Open the app at the printed server URL, usually `http://localhost:3000`.

Common checks:

```bash
bun src/index.ts --validate --graph-path ./data/graph
bun test
bun run build
```

## Graph storage

The default graph path is `./data/graph`:

```text
data/
  graph/
    node-types/
      person.json
      project.json
    edge-types/
      works-on.json
      related-to.json
    nodes/
      ada-lovelace.json
    edges/
      ada-lovelace-works-on-link.json
```

Each record is pretty-printed JSON with deterministic top-level key order and a trailing newline. Deletes remove files; Git keeps the historical copy. Link never runs Git commands for you.

## Git workflow

1. `git pull`.
2. Run Link locally and edit through the UI, HTTP API, or MCP tools.
3. Inspect JSON changes under `data/graph`.
4. `bun src/index.ts --validate --graph-path ./data/graph`.
5. `git add data/graph && git commit`.
6. `git pull --rebase` or merge, resolve JSON conflicts, re-run validation, then push.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `LINK_PORT` | `3000` | HTTP server port. `LINK_PORT` wins when both are set. |
| `GRAPH_PATH` / `LINK_GRAPH_PATH` | `./data/graph` | Graph JSON directory. `LINK_GRAPH_PATH` wins when both are set. |

## HTTP API overview

Core endpoints:

- `GET /api/health`
- `GET /api/graph`
- `GET /api/node-types`
- `POST /api/node-types`
- `PUT /api/node-types/:id`
- `DELETE /api/node-types/:id`
- `GET /api/edge-types`
- `POST /api/edge-types`
- `PUT /api/edge-types/:id`
- `DELETE /api/edge-types/:id`
- `GET /api/nodes`
- `POST /api/nodes`
- `GET /api/nodes/:id`
- `PUT /api/nodes/:id`
- `DELETE /api/nodes/:id`
- `GET /api/edges`
- `POST /api/edges`
- `GET /api/edges/:id`
- `PUT /api/edges/:id`
- `DELETE /api/edges/:id`
- `GET /api/search?q=...`
- `GET /api/nodes/:id/context`

Mutations do not require `expectedVersion`; invalid graph references fail with clear validation errors.

Example:

```bash
curl -s -X POST http://localhost:3000/api/nodes \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","typeId":"person"}'
```

## Realtime updates

Connect a WebSocket client to `/api/realtime`. Successful graph mutations broadcast `graph.changed` events without graph versions. Clients should refetch `/api/graph` after receiving a change event.

## MCP / agent usage

The `/mcp` endpoint is a standard MCP Streamable HTTP transport powered by `@modelcontextprotocol/sdk`. MCP clients connect to:

```text
http://localhost:3000/mcp
```

The server exposes local graph tools through MCP `tools/list` and `tools/call`, including `get_graph`, `search_graph`, `get_node_context`, and type/node/edge mutation tools. There is no auth and no `expectedVersion`.

Agent workflow guidance is documented in `docs/link-agent-instructions.md`.

## Container usage

Build the image:

```bash
docker build -t link .
```

Run with graph data mounted:

```bash
docker run --rm -p 3000:3000 -v "$PWD/data/graph:/app/data/graph" link
```

Use `LINK_GRAPH_PATH` if you mount the graph somewhere else inside the container.
