# Link

Link is a Bun + React graph tracker for flexible work-related entities and relationships. It stores a small graph of nodes and edges in SQLite, exposes deterministic HTTP APIs, broadcasts realtime graph updates over WebSockets, and includes a standard MCP server for agent workflows.

## Features

- Dynamic node types and edge types.
- Directed and bidirectional edges.
- Metadata schemas for declared fields, while preserving unknown metadata fields for flexibility.
- Slug IDs with collision handling.
- Optimistic concurrency through required `expectedVersion` values on mutations.
- Tombstone deletes and append-only history.
- Full graph seed, import, and export workflows.
- Web UI for graph creation, search, context inspection, import/export, and SVG graph navigation.
- Realtime refresh through `/api/realtime`.
- Local no-auth actor mode with future auth boundary.
- SQLite persistence through `bun:sqlite`.

## Local development

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun run dev
```

Open the app at the printed server URL, usually `http://localhost:3000`.

Run tests:

```bash
bun test
```

Build the browser app:

```bash
bun run build
```

Run production mode locally:

```bash
bun start
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port. |
| `AUTH_MODE` | `none` | Current auth mode. Only `none` is implemented. |
| `DATABASE_PROVIDER` | `sqlite` | Current database provider. Only `sqlite` is implemented. |
| `SQLITE_PATH` | `.data/link.sqlite` in development, `/data/link.sqlite` in production | SQLite database path. |
| `ADMIN_ENABLED` | `true` outside production, `false` in production | Enables admin seed endpoint. |

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
- `GET /api/history`
- `GET /api/history/:version`
- `GET /api/export`
- `POST /api/import`
- `POST /api/admin/seed/bootstrap`

All mutations require `expectedVersion` in the JSON body or query string. Stale writes return `409`.

Example:

```bash
curl -s -X POST http://localhost:3000/api/admin/seed/bootstrap
curl -s -X POST http://localhost:3000/api/nodes \
  -H 'content-type: application/json' \
  -d '{"expectedVersion":1,"name":"Ada Lovelace","typeId":"person"}'
```

## Realtime updates

Connect a WebSocket client to:

```text
/api/realtime
```

Successful graph mutations broadcast `graph.changed` events with the new graph version. Clients should refetch `/api/graph` after receiving a change event.

## MCP / agent usage

The `/mcp` endpoint is a standard MCP Streamable HTTP transport powered by `@modelcontextprotocol/sdk`. MCP clients should connect to:

```text
http://localhost:3000/mcp
```

The server exposes graph tools through MCP `tools/list` and `tools/call`, including `get_graph`, `search_graph`, `get_node_context`, type/node/edge mutation tools, `get_history`, and `export_graph`. Mutation tools require the latest graph `expectedVersion`, matching the HTTP API's optimistic concurrency behavior.

Agent workflow guidance is documented in `docs/link-agent-instructions.md`.

## Import and export

Export:

```bash
curl -s http://localhost:3000/api/export > link-export.json
```

Import:

```bash
curl -s -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' \
  --data-binary @link-export.json
```

Import replaces the graph data with the supplied export payload and records an import history entry.

## Container usage

Build the image:

```bash
docker build -t link .
```

Run with persistent SQLite data:

```bash
docker run --rm -p 3000:3000 -v "$PWD/.data:/data" \
  -e ADMIN_ENABLED=true \
  link
```

The container uses `/data/link.sqlite` by default. Mount `/data` to preserve graph data across restarts.

## Validation

Before shipping changes, run:

```bash
bun test
bun run build
```

For app-level validation, start the server and exercise:

1. `GET /api/health`.
2. `POST /api/admin/seed/bootstrap` when admin is enabled.
3. Node and edge creation through HTTP.
4. `GET /api/search` and `GET /api/nodes/:id/context`.
5. Export/import.
6. Web UI load and graph interactions.
7. WebSocket realtime refresh.
8. MCP `tools/list` and `tools/call`.
