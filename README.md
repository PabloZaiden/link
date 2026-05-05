# Link

Link is a tool to track relationships between entities in an agent-friendly way. Build and query knowledge graphs through a simple API, WebSocket interface, or MCP.

## Features

- Model people, projects, documents, systems, or any other domain with custom node and edge types.
- Capture both directional and mutual relationships so the graph matches how your data actually connects.
- Keep structured metadata on records without blocking extra fields that matter to your workflow.
- Query and update the same graph from the web app, HTTP API, WebSocket clients, or MCP-compatible agents.
- Start quickly with built-in starter types for an empty graph, or define your own model from scratch.
- Store graph data as plain JSON files that are easy to inspect, diff, review, and version with Git.
- Validate the graph before committing to catch malformed records, broken references, and merge issues early.

## Installation

Install the latest Linux or macOS binary release:

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/installer/v0.0.2/install.sh | sh -s -- pablozaiden/link
```

The shared installer reads Link's installer manifest, downloads the latest release for your platform, verifies its checksum, and installs it as `link-cli` in `$HOME/.local/bin`. If that directory is not on your `PATH`, the installer prints the shell profile line to add.

Installed binaries can check for or install release updates:

```bash
link-cli update --check
link-cli update
link-cli update --version 0.1.0
```

The update command works from an installed `link-cli` binary. When running from source, use the installer or download a release binary instead.

## Local development

```bash
bun install
bun run dev
```

Open the app at the printed server URL, usually `http://localhost:3000`.

To create the default node and edge types for an empty graph, run:

```bash
bun src/index.ts seed
```

Common checks:

```bash
bun src/index.ts validate
bun test
bun run build
```

## CLI usage

Running `link-cli` with no arguments shows the current CLI version and available top-level commands:

```bash
link-cli
link-cli web
link-cli validate
link-cli seed
link-cli update --check
link-cli graph
```

- `web` starts the web UI, HTTP API, realtime endpoint, and MCP endpoint.
- `validate` validates graph JSON files.
- `seed` creates the default graph node and edge types when the graph is empty.
- `update` checks for or installs newer release binaries.
- `graph` exposes the same graph actions as the MCP server for direct CLI use.

Graph CLI action names match MCP tool names exactly. Use `link-cli graph` to list actions and `link-cli graph <action> --help` for action-specific help:

```bash
link-cli graph get_graph
link-cli graph search_graph --query ada
link-cli graph create_node --json '{"name":"Ada Lovelace","typeId":"person"}'
```

## Graph storage

The default graph path is `./.data/graph`, but Link does not create `.data` or graph collection directories until a mutation saves data or explicit `seed` bootstrap data is written:

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

If the graph is empty and you want the built-in starter types, run `bun src/index.ts seed` or `link-cli seed`. Seeding is skipped when any graph JSON records already exist, so it will not backfill defaults into an existing graph.

## Collaborative Link with Git workflow

1. Create a new, emtpy Git repository.
1. Run Link locally and edit through the UI, HTTP API, MCP tools, or CLI graph actions. Use `link-cli seed` first only when you want default types in an empty graph.
1. Inspect JSON changes under `.data/graph`.
1. `git add .data/graph && git commit`.
1. `git pull` and merge or resolve JSON conflicts.
1. Run `link-cli validate` to ensure the graph is consistent.
1. `git push`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `LINK_PORT` | `3000` | HTTP server port. `LINK_PORT` wins when both are set. |
| `LINK_DATA_DIR` | `./.data` | Base data directory. Graph JSON is always stored under the fixed `graph/` subdirectory inside it. |
| `LINK_GRAPH_WATCH_DEBOUNCE_MS` | `50` | Debounce for filesystem graph change events in web mode. Set to `0` to disable watching for external graph JSON changes. |

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

Example:

```bash
curl -s -X POST http://localhost:3000/api/nodes \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","typeId":"person"}'
```

This example assumes the `person` node type already exists, either from `link-cli seed` or from creating that type yourself.

## Realtime updates

Connect a WebSocket client to `/api/realtime`. Successful in-process graph mutations broadcast `graph.changed` events. The web server also watches graph JSON files and broadcasts `graph.changed` when another process, such as `link-cli graph`, changes the graph. Clients should refetch `/api/graph` after receiving a change event.

## MCP / agent usage

The `/mcp` endpoint is a standard MCP Streamable HTTP transport powered by `@modelcontextprotocol/sdk`. MCP clients connect to:

```text
http://localhost:3000/mcp
```

The server exposes local graph tools through MCP `tools/list` and `tools/call`, including `get_graph`, `search_graph`, `get_node_context`, and type/node/edge mutation tools. The same tool names are available through `link-cli graph <tool_name>` when MCP is not connected.

Agent workflow guidance is packaged as the Agent Skills-compatible skill in `skills/link/SKILL.md`.

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
docker run --rm -v "$PWD/.data:/data" link link-cli seed
```
