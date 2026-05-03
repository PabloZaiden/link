# Link

Link is a local-first Bun + React graph tracker for flexible work-related entities and relationships. Graph data is stored as canonical, Git-friendly JSON files under `./.data/graph` after the first save; Git is the history, collaboration, backup, and conflict-resolution layer.

## Features

- Dynamic node types and edge types.
- Directed and bidirectional edges.
- Metadata schemas for declared fields, while preserving unknown metadata fields.
- One JSON file per graph record with slug IDs mapped directly to file names.
- Explicit bootstrap of default node and edge types with `--seed`.
- Deterministic HTTP APIs, realtime WebSocket refresh, and local-only MCP tools.
- Validation CLI for catching malformed JSON, merge conflicts, and broken references.

## Installation

Install the latest Linux or macOS binary release:

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/link/main/install.sh | sh
```

The installer downloads the latest release for your platform and installs it as `link` in `$HOME/.local/bin`. If that directory is not on your `PATH`, the installer prints the shell profile line to add.

## Local development

```bash
bun install
bun run dev
```

Open the app at the printed server URL, usually `http://localhost:3000`.

To create the default node and edge types for an empty graph, start Link once with `--seed`:

```bash
bun src/index.ts --seed
```

Common checks:

```bash
bun src/index.ts --validate
bun test
bun run build
```

## Graph storage

The default graph path is `./.data/graph`, but Link does not create `.data` or graph collection directories until a mutation saves data or explicit `--seed` bootstrap data is written:

```text
.data/
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

If the graph is empty and you want the built-in starter types, run `bun src/index.ts --seed`. Seeding is skipped when any graph JSON records already exist, so it will not backfill defaults into an existing graph.

## Git workflow

1. `git pull`.
2. Run Link locally and edit through the UI, HTTP API, or MCP tools. Use `bun src/index.ts --seed` first only when you want default types in an empty graph.
3. Inspect JSON changes under `.data/graph`.
4. `bun src/index.ts --validate`.
5. `git add .data/graph && git commit`.
6. `git pull --rebase` or merge, resolve JSON conflicts, re-run validation, then push.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `LINK_PORT` | `3000` | HTTP server port. `LINK_PORT` wins when both are set. |
| `LINK_DATA_DIR` | `./.data` | Base data directory. Graph JSON is always stored under the fixed `graph/` subdirectory inside it. |

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

This example assumes the `person` node type already exists, either from `--seed` or from creating that type yourself.

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
docker run --rm -p 3000:3000 -v "$PWD/.data:/data" link
```

Use `LINK_DATA_DIR` if you mount the data directory somewhere else inside the container. To seed an empty mounted graph, override the container command explicitly:

```bash
docker run --rm -p 3000:3000 -v "$PWD/.data:/data" link bun src/index.ts --seed
```
