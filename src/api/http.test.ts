import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { serve, type Server } from "bun";
import index from "../index.html";
import { RealtimeHub } from "../realtime/hub";
import { createApp } from "../server/app";
import { JsonGraphRepository } from "../storage/json";
import { callLinkTool } from "../mcp/tools";
import { linkMcpTools } from "../mcp/server";

let server: Server<undefined> | null = null;
let repository: JsonGraphRepository | null = null;
let graphRoot: string | null = null;

function tempGraphPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "link-http-tools-")), "graph");
}

function cleanup(graphPath: string): void {
  rmSync(path.dirname(graphPath), { recursive: true, force: true });
}

afterEach(() => {
  server?.stop(true);
  server = null;
  repository?.close();
  repository = null;
  if (graphRoot) rmSync(graphRoot, { recursive: true, force: true });
  graphRoot = null;
});

async function start() {
  graphRoot = mkdtempSync(path.join(tmpdir(), "link-http-"));
  const graphPath = path.join(graphRoot, "graph");
  repository = new JsonGraphRepository(graphPath);
  const app = createApp({
    index,
    repository,
    config: { port: 0, graphPath },
  });
  server = serve(app);
  return String(server.url).replace(/\/$/, "");
}

async function request<T>(base: string, requestPath: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${requestPath}`, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as T;
  expect(response.ok).toBe(true);
  return body;
}

describe("HTTP API", () => {
  test("supports automatic bootstrap, CRUD, search, context, and no version fields", async () => {
    const base = await start();
    const health = await request<{ ok: boolean; graphPath: string }>(base, "/api/health");
    expect(health.ok).toBe(true);
    expect(health.graphPath).toContain("graph");

    const initial = await request<{ nodeTypes: { id: string }[]; version?: number }>(base, "/api/graph");
    expect(initial.version).toBeUndefined();
    expect(initial.nodeTypes.some(type => type.id === "person")).toBe(true);

    const ada = await request<{ record: { id: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ name: "Ada", typeId: "person" }),
    });
    const link = await request<{ record: { id: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ name: "Link", typeId: "project" }),
    });
    const edge = await request<{ record: { id: string } }>(base, "/api/edges", {
      method: "POST",
      body: JSON.stringify({
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
  });

  test("returns validation errors and removed endpoints are unavailable", async () => {
    const base = await start();

    const invalidJson = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(((await invalidJson.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");

    const malformedNode = await fetch(`${base}/api/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42, typeId: "person" }),
    });
    expect(malformedNode.status).toBe(400);

    expect((await fetch(`${base}/api/history`)).headers.get("content-type") ?? "").toContain("text/html");
    expect((await fetch(`${base}/api/export`)).headers.get("content-type") ?? "").toContain("text/html");
    expect((await fetch(`${base}/api/admin/seed/bootstrap`, { method: "POST" })).ok).toBe(false);
  });

  test("broadcasts realtime mutation events without versions", async () => {
    const base = await start();
    const socketBase = base.replace("http://", "ws://").replace("https://", "wss://");
    const socket = new WebSocket(`${socketBase}/api/realtime`);
    const messages: string[] = [];
    socket.addEventListener("message", event => messages.push(String(event.data)));
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));

    await request(base, "/api/nodes", { method: "POST", body: JSON.stringify({ name: "Broadcast", typeId: "person" }) });
    await Bun.sleep(50);
    const change = messages.find(message => message.includes("graph.changed") && message.includes("node"));
    expect(change).toBeDefined();
    expect(change).not.toContain("version");
    socket.close();
  });

  test("supports versionless MCP tools with shared graph state", () => {
    const graphPath = tempGraphPath();
    try {
      const toolRepository = new JsonGraphRepository(graphPath);
      const realtime = new RealtimeHub();
      const createNodeTool = linkMcpTools.find(tool => tool.name === "create_node");
      expect(Object.keys(createNodeTool?.inputSchema ?? {})).not.toContain("expectedVersion");
      const toolNames = linkMcpTools.map(tool => String(tool.name));
      expect(toolNames).not.toContain("get_history");
      expect(toolNames).not.toContain("export_graph");

      const created = callLinkTool("create_node", { name: "MCP Node", typeId: "person" }, { repository: toolRepository, realtime }) as { record: { id: string } };
      const updated = callLinkTool("update_node", { id: created.record.id, name: "MCP Node Updated" }, { repository: toolRepository, realtime }) as {
        record: { name: string };
      };
      expect(updated.record.name).toBe("MCP Node Updated");

      const graph = toolRepository.getSnapshot();
      expect(graph.nodes.some(node => node.id === created.record.id)).toBe(true);

      const search = callLinkTool("search_graph", { query: "MCP Node Updated" }, { repository: toolRepository, realtime }) as { nodes: { id: string }[] };
      expect(search.nodes[0]?.id).toBe(created.record.id);
    } finally {
      cleanup(graphPath);
    }
  });
});
