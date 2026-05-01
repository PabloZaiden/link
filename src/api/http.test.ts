import { afterEach, describe, expect, test } from "bun:test";
import { serve, type Server } from "bun";
import index from "../index.html";
import { createApp } from "../server/app";
import { SqliteGraphRepository } from "../storage/sqlite";

let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

async function start() {
  const repository = new SqliteGraphRepository(":memory:");
  const app = createApp({
    index,
    repository,
    config: { port: 0, authMode: "none", databaseProvider: "sqlite", sqlitePath: ":memory:", adminEnabled: true },
  });
  server = serve(app);
  return String(server.url).replace(/\/$/, "");
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as T;
  expect(response.ok).toBe(true);
  return body;
}

describe("HTTP API", () => {
  test("supports health, seed, CRUD, search, context, export, and stale conflicts", async () => {
    const base = await start();
    const health = await request<{ ok: boolean }>(base, "/api/health");
    expect(health.ok).toBe(true);

    const seeded = await request<{ version: number }>(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    const ada = await request<{ version: number; record: { id: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: seeded.version, name: "Ada", typeId: "person" }),
    });
    const link = await request<{ version: number; record: { id: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: ada.version, name: "Link", typeId: "project" }),
    });
    const edge = await request<{ version: number; record: { id: string } }>(base, "/api/edges", {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: link.version,
        typeId: "works-on",
        sourceNodeId: ada.record.id,
        targetNodeId: link.record.id,
        direction: "directed",
      }),
    });

    const search = await request<{ nodes: { id: string }[] }>(base, "/api/search?q=Ada");
    expect(search.nodes[0]?.id).toBe(ada.record.id);
    const context = await request<{ edges: { id: string }[] }>(base, `/api/nodes/${ada.record.id}/context`);
    expect(context.edges[0]?.id).toBe(edge.record.id);
    const exported = await request<{ nodes: unknown[] }>(base, "/api/export");
    expect(exported.nodes.length).toBe(2);

    const staleResponse = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, name: "Stale", typeId: "person" }),
    });
    expect(staleResponse.status).toBe(409);
  });

  test("broadcasts realtime mutation events", async () => {
    const base = await start();
    const socketBase = base.replace("http://", "ws://").replace("https://", "wss://");
    const socket = new WebSocket(`${socketBase}/api/realtime`);
    const messages: string[] = [];
    socket.addEventListener("message", event => messages.push(String(event.data)));
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));

    await request(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    await Bun.sleep(50);
    expect(messages.some(message => message.includes("graph.changed"))).toBe(true);
    socket.close();
  });

  test("supports MCP tools with shared graph state", async () => {
    const base = await start();
    await request(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    const graph = await request<{ version: number }>(base, "/api/graph");
    const created = await request<{ result: { version: number; record: { id: string } } }>(base, "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_node",
          arguments: { expectedVersion: graph.version, name: "MCP Node", typeId: "person" },
        },
      }),
    });

    const search = await request<{ result: { nodes: { id: string }[] } }>(base, "/mcp", {
      method: "POST",
      body: JSON.stringify({ tool: "search_graph", args: { query: "MCP Node" } }),
    });

    expect(search.result.nodes[0]?.id).toBe(created.result.record.id);
  });
});
