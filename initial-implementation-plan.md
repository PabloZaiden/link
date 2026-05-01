# Link implementation plan

## Problem and approach

Link needs to become a graph-backed, API-first application for tracking relationships between flexible work-related entities. The current repository is a Bun + React starter, so implementation should build the core graph platform from the ground up while preserving future flexibility for cloud deployment, multi-user access, MCP/agent usage, and alternative databases.

The initial implementation should use Bun, React, and a storage abstraction backed by SQLite locally. SQLite data must live under a container-mountable data path so installations can preserve data. The storage layer should make it straightforward to later configure a different database backend, likely Azure SQL Database, without rewriting API/UI/MCP logic.

The server should run as a container exposing the web UI, deterministic API, and MCP server. The data model should support dynamic node and edge types, directed and bidirectional edges, metadata, versioned tombstones, append-only history, optimistic concurrency, live UI updates, and agent-friendly graph retrieval/search.

## Key decisions captured

- Start with SQLite via `bun:sqlite`, but hide it behind a repository/storage interface and configuration.
- Add a Dockerfile and use a clear mount path for persistent SQLite data, such as `/data/link.sqlite`.
- Design for future Azure SQL Database or similar external DB by making database selection/configuration environment-driven.
- Use nodes with required fields like `name`, `type`, `description`, and `metadata`.
- Treat aliases and status/info updates as normal dynamic graph concepts, not built-in special cases.
- Include inherent timestamps/history metadata to support sorting connected nodes and future time-based views.
- Use versioned tombstones for deletes.
- Store bidirectional links as one edge with direction metadata.
- Block deleting currently used node/edge types, but ignore historic/tombstoned usage when deciding if a type is currently in use.
- Prioritize logical graph correctness first, then graph visualization/navigation.
- Implement MCP early because agent usage is expected to be a primary interaction mode.
- Put confirmation behavior in the agent skill/instructions rather than forcing it in the MCP tools.
- Include an auth/multi-user boundary from the start, with no-auth mode defaulting to a single local user.
- Support seed/bootstrap data for initial types and richer development/test graphs.
- Generate graph record IDs as slugs, with collision handling.
- Make seeding explicit through commands/API/admin actions, not automatic on first startup.
- Run MCP from the same Bun server/container process as the UI and API.
- Include full graph JSON import/export from the beginning to support development, backup, and migration workflows.
- On stale graph version conflicts, preserve the user's pending edits, refresh the graph, and retry/merge when the changed records are independent. If the affected records changed, show a conflict and let the user reapply safely.
- Support metadata field schemas from the beginning, validating declared fields while still allowing unknown metadata fields as an escape hatch.

## Phased plan

### 1. Foundation and configuration

- Replace the starter API structure with an application structure organized around domain, storage, API, realtime, MCP, and UI.
- Add environment-driven configuration for server port, auth mode, database provider, database connection details, and SQLite data path.
- Add Dockerfile and container-friendly defaults.
- Document local/container startup and persistent data mounting.

### 2. Graph domain model

- Define TypeScript domain types for graph nodes, edges, node types, edge types, graph versions, change records, users/actors, and metadata.
- Generate stable slug IDs from user-facing names with collision handling, while allowing explicit slugs when needed.
- Model edge direction as `directed` or `bidirectional`.
- Use opaque IDs and timestamps consistently.
- Make tombstone state explicit so deleted records remain available for history but are excluded from current graph queries.
- Keep aliases, status updates, project updates, and other future concepts expressible through dynamic node/edge types.
- Support optional metadata field schemas on node and edge types. A schema-backed type could look like:

```json
{
  "id": "project",
  "name": "Project",
  "metadataSchema": {
    "status": {
      "type": "string",
      "label": "Status",
      "options": ["not-started", "active", "blocked", "done"]
    },
    "targetDate": {
      "type": "date",
      "label": "Target date"
    },
    "priority": {
      "type": "number",
      "label": "Priority"
    }
  }
}
```

With this, a `Project` node still stores metadata as JSON, but the UI/API can validate declared fields and render better forms. Unknown metadata fields remain allowed as an escape hatch for ad hoc information and future schema evolution.

### 3. Storage abstraction and SQLite implementation

- Create a storage/repository interface for all graph operations.
- Implement SQLite schema and migrations.
- Store active graph records, type definitions, revision/change history, and tombstones.
- Ensure all writes are transactional.
- Require optimistic concurrency for mutations by checking the expected current graph version.
- Add seed support for bootstrap types and full development/test graphs.
- Add explicit seed commands and/or admin-only API actions for bootstrap types and development/test graph data.
- Add full graph JSON import/export that preserves graph versions, tombstones, types, nodes, edges, and history where practical.

### 4. Deterministic HTTP API

- Implement API routes for:
  - Current graph retrieval.
  - Node CRUD.
  - Edge CRUD.
  - Node type CRUD.
  - Edge type CRUD.
  - Search/fuzzy lookup.
  - Node neighborhood/context.
  - Revision/history access.
  - Full graph import/export.
  - Seed/bootstrap operations if appropriate for development/admin use.
- Use clear validation and error responses.
- Reject stale writes when the client submits an outdated graph version.
- Exclude tombstoned records from current graph responses by default.

### 5. MCP server and agent usage

- Expose MCP tools backed by the same domain/storage layer as the API.
- Serve MCP from the same Bun server/container process as the UI and API.
- Include tools for full graph retrieval, fuzzy search, node context, node/edge/type mutations, and history lookup.
- Add agent instructions/skill documentation explaining expected workflow:
  - Load or search the graph.
  - Inspect direct connections.
  - Propose exact intended changes.
  - Ask the user for confirmation before mutating.
  - Apply changes through MCP/API.
- Keep confirmation in the skill instructions, not hard-coded in the MCP server.

### 6. Web UI for logical graph management

- Replace starter UI with a practical graph management interface.
- Implement views for:
  - Graph overview.
  - Node list/search.
  - Node detail and direct connections.
  - Node create/edit/delete.
  - Edge create/edit/delete.
  - Node/edge type management.
  - Current graph version and conflict handling.
- Autosave changes by submitting deterministic mutations immediately.
- Handle stale write conflicts without losing form state or pending graph edits.
- Attempt a simple automatic retry/merge when another user changed unrelated records. If the same node, edge, or type changed, refresh the graph and show a conflict state that lets the user reapply their pending changes.

### 7. Realtime updates

- Add WebSocket support through `Bun.serve()`.
- Broadcast successful graph changes with the new graph version.
- Have the UI subscribe and refresh current graph state after changes.
- Keep HTTP/API writes as the source of truth.

### 8. Graph visualization and navigation

- Add a React-compatible graph visualization once the logical graph workflows are stable.
- Use visualization for browsing and navigation while retaining forms/details panels for deterministic editing.
- Support selecting a node, exploring neighbors, and filtering by type/relationship.

### 9. Auth and multi-user readiness

- Add an auth abstraction from the beginning.
- Implement no-auth/local mode with a single default actor.
- Store actor information on changes.
- Leave room for Entra ID integration for UI, API, and MCP in a later phase.

### 10. Testing and validation

- Add Bun tests for domain invariants, storage transactions, version conflicts, tombstones, type deletion rules, search, and API behavior.
- Add seed data tests.
- Test import/export round trips.
- Validate build and container startup.

## Todos

- Establish app foundation, configuration, Dockerfile, and documentation.
- Define graph domain model and invariants.
- Implement storage abstraction, SQLite schema, migrations, and seed support.
- Implement deterministic graph API.
- Implement MCP tools and agent instructions.
- Build web UI for graph CRUD/search/type management.
- Add realtime WebSocket updates.
- Add graph visualization/navigation.
- Add auth abstraction and local default actor.
- Add tests for domain, storage, API, and realtime behavior.

## Remaining questions

No open planning questions at this point.
