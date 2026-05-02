import { afterEach, describe, expect, test } from "bun:test";
import { serve, type Server } from "bun";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import index from "../index.html";
import { createApp } from "../server/app";
import { SqliteGraphRepository } from "../storage/sqlite";

let server: Server | null = null;
let repository: SqliteGraphRepository | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
  repository?.close();
  repository = null;
});

async function start() {
  repository = new SqliteGraphRepository(":memory:");
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

async function connectMcpClient(base: string): Promise<Client> {
  const client = new Client({ name: "link-test-client", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

function textResult<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  if ("toolResult" in result) return result.toolResult as T;
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return JSON.parse(first.text) as T;
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if ("toolResult" in result) return JSON.stringify(result.toolResult);
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return first.text;
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

  test("returns validation errors for invalid JSON and malformed mutation bodies", async () => {
    const base = await start();

    const invalidJson = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(((await invalidJson.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");

    const seeded = await request<{ version: number }>(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    const malformedNode = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: seeded.version, name: 42, typeId: "person" }),
    });
    expect(malformedNode.status).toBe(400);
    expect(((await malformedNode.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");

    const missingVersion = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No version", typeId: "person" }),
    });
    expect(missingVersion.status).toBe(400);
    expect(((await missingVersion.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });

  test("validates history version path parameters", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/history/not-a-version`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });

  test("returns validation errors for malformed import payload arrays", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeTypes: [], edgeTypes: [], nodes: {}, edges: [], tombstones: { nodeTypes: [], edgeTypes: [], nodes: [], edges: [] } }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
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

  test("supports standard MCP tools with shared graph state", async () => {
    const base = await start();
    await request(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    const graph = await request<{ version: number }>(base, "/api/graph");
    const client = await connectMcpClient(base);

    const tools = await client.listTools();
    const createNodeTool = tools.tools.find(tool => tool.name === "create_node");
    expect(createNodeTool?.inputSchema.required).toContain("expectedVersion");
    expect(tools.tools.some(tool => tool.name === "search_graph")).toBe(true);

    const created = textResult<{ version: number; record: { id: string } }>(
      await client.callTool({ name: "create_node", arguments: { expectedVersion: graph.version, name: "MCP Node", typeId: "person" } }),
    );
    const apiGraph = await request<{ nodes: { id: string }[] }>(base, "/api/graph");
    expect(apiGraph.nodes.some(node => node.id === created.record.id)).toBe(true);

    const search = textResult<{ nodes: { id: string }[] }>(await client.callTool({ name: "search_graph", arguments: { query: "MCP Node" } }));
    expect(search.nodes[0]?.id).toBe(created.record.id);

    await client.close();
  });

  test("returns client-compatible MCP tool errors and broadcasts MCP mutations", async () => {
    const base = await start();
    const socketBase = base.replace("http://", "ws://").replace("https://", "wss://");
    const socket = new WebSocket(`${socketBase}/api/realtime`);
    const messages: string[] = [];
    socket.addEventListener("message", event => messages.push(String(event.data)));
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));

    await request(base, "/api/admin/seed/bootstrap", { method: "POST", body: "{}" });
    const graph = await request<{ version: number }>(base, "/api/graph");
    const client = await connectMcpClient(base);

    const stale = await client.callTool({ name: "create_node", arguments: { expectedVersion: 0, name: "Stale MCP Node", typeId: "person" } });
    expect("isError" in stale && stale.isError).toBe(true);
    const staleError = textResult<{ code: string }>(stale);
    expect(staleError.code).toBe("CONFLICT");

    const missingVersion = await client.callTool({ name: "create_node", arguments: { name: "Missing Version", typeId: "person" } });
    expect("isError" in missingVersion && missingVersion.isError).toBe(true);
    expect(resultText(missingVersion)).toContain("expectedVersion");

    await client.callTool({ name: "create_node", arguments: { expectedVersion: graph.version, name: "Broadcast MCP Node", typeId: "person" } });
    await Bun.sleep(50);
    expect(messages.some(message => message.includes("graph.changed") && message.includes("node"))).toBe(true);

    const unknown = await client.callTool({ name: "unknown_link_tool", arguments: {} });
    expect("isError" in unknown && unknown.isError).toBe(true);
    expect(resultText(unknown)).toContain("not found");
    await client.close();
    socket.close();
  });
});
