import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { serve, type Server } from "bun";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  repository = new JsonGraphRepository(graphPath, { seed: true });
  const app = createApp({
    index,
    repository,
    config: { port: 0, graphPath, graphPollIntervalMs: 0 },
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
  test("supports explicit seed bootstrap, CRUD, search, context, and no version fields", async () => {
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

  test("supports API CRUD across node types, edge types, nodes, and edges", async () => {
    const base = await start();

    const nodeType = await request<{ record: { id: string; name: string; immutable?: boolean } }>(base, "/api/node-types", {
      method: "POST",
      body: JSON.stringify({ id: "initiative", name: "Initiative", immutable: true }),
    });
    expect(nodeType.record.id).toBe("initiative");
    expect(nodeType.record.immutable).toBe(true);

    const updatedNodeType = await request<{ record: { description?: string } }>(base, "/api/node-types/initiative", {
      method: "PUT",
      body: JSON.stringify({ description: "Tracked initiative" }),
    });
    expect(updatedNodeType.record.description).toBe("Tracked initiative");

    const edgeType = await request<{ record: { id: string; name: string } }>(base, "/api/edge-types", {
      method: "POST",
      body: JSON.stringify({ id: "supports", name: "supports" }),
    });
    expect(edgeType.record.id).toBe("supports");

    const updatedEdgeType = await request<{ record: { description?: string } }>(base, "/api/edge-types/supports", {
      method: "PUT",
      body: JSON.stringify({ description: "Support relationship" }),
    });
    expect(updatedEdgeType.record.description).toBe("Support relationship");

    const source = await request<{ record: { id: string; name: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ name: "Source", typeId: "person" }),
    });
    const target = await request<{ record: { id: string; name: string } }>(base, "/api/nodes", {
      method: "POST",
      body: JSON.stringify({ name: "Target", typeId: "initiative" }),
    });

    const fetchedNode = await request<{ id: string }>(base, `/api/nodes/${source.record.id}`);
    expect(fetchedNode.id).toBe(source.record.id);

    const updatedNode = await request<{ record: { name: string } }>(base, `/api/nodes/${source.record.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Source Updated" }),
    });
    expect(updatedNode.record.name).toBe("Source Updated");

    const createdEdge = await request<{ record: { id: string } }>(base, "/api/edges", {
      method: "POST",
      body: JSON.stringify({
        typeId: "supports",
        sourceNodeId: source.record.id,
        targetNodeId: target.record.id,
        direction: "directed",
      }),
    });

    const fetchedEdge = await request<{ id: string }>(base, `/api/edges/${createdEdge.record.id}`);
    expect(fetchedEdge.id).toBe(createdEdge.record.id);

    const updatedEdge = await request<{ record: { description?: string } }>(base, `/api/edges/${createdEdge.record.id}`, {
      method: "PUT",
      body: JSON.stringify({ description: "Updated edge" }),
    });
    expect(updatedEdge.record.description).toBe("Updated edge");

    const deletedEdge = await request<{ deletedId: string }>(base, `/api/edges/${createdEdge.record.id}`, {
      method: "DELETE",
    });
    expect(deletedEdge.deletedId).toBe(createdEdge.record.id);

    const deletedSource = await request<{ deletedId: string }>(base, `/api/nodes/${source.record.id}`, {
      method: "DELETE",
    });
    expect(deletedSource.deletedId).toBe(source.record.id);

    const deletedTarget = await request<{ deletedId: string }>(base, `/api/nodes/${target.record.id}`, {
      method: "DELETE",
    });
    expect(deletedTarget.deletedId).toBe(target.record.id);

    const deletedEdgeType = await request<{ deletedId: string }>(base, "/api/edge-types/supports", {
      method: "DELETE",
    });
    expect(deletedEdgeType.deletedId).toBe("supports");

    const deletedNodeType = await request<{ deletedId: string }>(base, "/api/node-types/initiative", {
      method: "DELETE",
    });
    expect(deletedNodeType.deletedId).toBe("initiative");
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
      const toolRepository = new JsonGraphRepository(graphPath, { seed: true });
      const realtime = new RealtimeHub();
      const createNodeTool = linkMcpTools.find(tool => tool.name === "create_node");
      const createNodeTypeTool = linkMcpTools.find(tool => tool.name === "create_node_type");
      expect(Object.keys(createNodeTool?.inputSchema ?? {})).not.toContain("expectedVersion");
      expect(Object.keys(createNodeTypeTool?.inputSchema ?? {})).toContain("immutable");
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

  test("supports MCP HTTP list and full tool lifecycle over /mcp", async () => {
    const base = await start();
    const client = new Client({ name: "http-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));

    try {
      await client.connect(transport);

      const listedTools = await client.listTools();
      expect(listedTools.tools.map(tool => tool.name)).toEqual(linkMcpTools.map(tool => tool.name));

      const initialGraph = await client.callTool({ name: "get_graph", arguments: {} });
      expect(initialGraph.structuredContent).toBeDefined();

      const nodeType = await client.callTool({
        name: "create_node_type",
        arguments: { id: "initiative", name: "Initiative" },
      });
      expect((nodeType.structuredContent as { record: { id: string } }).record.id).toBe("initiative");

      const edgeType = await client.callTool({
        name: "create_edge_type",
        arguments: { id: "supports", name: "supports" },
      });
      expect((edgeType.structuredContent as { record: { id: string } }).record.id).toBe("supports");

      const sourceNode = await client.callTool({
        name: "create_node",
        arguments: { name: "Ada", typeId: "person" },
      });
      const sourceNodeId = (sourceNode.structuredContent as { record: { id: string } }).record.id;

      const targetNode = await client.callTool({
        name: "create_node",
        arguments: { name: "Project Link", typeId: "initiative" },
      });
      const targetNodeId = (targetNode.structuredContent as { record: { id: string } }).record.id;

      const updatedNode = await client.callTool({
        name: "update_node",
        arguments: { id: sourceNodeId, name: "Ada Lovelace" },
      });
      expect((updatedNode.structuredContent as { record: { name: string } }).record.name).toBe("Ada Lovelace");

      const createdEdge = await client.callTool({
        name: "create_edge",
        arguments: {
          typeId: "supports",
          sourceNodeId,
          targetNodeId,
          direction: "directed",
        },
      });
      const edgeId = (createdEdge.structuredContent as { record: { id: string } }).record.id;

      const updatedEdge = await client.callTool({
        name: "update_edge",
        arguments: { id: edgeId, description: "Primary support" },
      });
      expect((updatedEdge.structuredContent as { record: { description?: string } }).record.description).toBe("Primary support");

      const context = await client.callTool({
        name: "get_node_context",
        arguments: { nodeId: sourceNodeId },
      });
      expect((context.structuredContent as { edges: { id: string }[] }).edges[0]?.id).toBe(edgeId);

      const search = await client.callTool({
        name: "search_graph",
        arguments: { query: "Ada Lovelace" },
      });
      expect((search.structuredContent as { nodes: { id: string }[] }).nodes[0]?.id).toBe(sourceNodeId);

      const deletedEdge = await client.callTool({
        name: "delete_edge",
        arguments: { id: edgeId },
      });
      expect((deletedEdge.structuredContent as { deletedId: string }).deletedId).toBe(edgeId);

      const deletedSourceNode = await client.callTool({
        name: "delete_node",
        arguments: { id: sourceNodeId },
      });
      expect((deletedSourceNode.structuredContent as { deletedId: string }).deletedId).toBe(sourceNodeId);

      const deletedTargetNode = await client.callTool({
        name: "delete_node",
        arguments: { id: targetNodeId },
      });
      expect((deletedTargetNode.structuredContent as { deletedId: string }).deletedId).toBe(targetNodeId);

      const updatedNodeType = await client.callTool({
        name: "update_node_type",
        arguments: { id: "initiative", description: "Tracked initiative" },
      });
      expect((updatedNodeType.structuredContent as { record: { description?: string } }).record.description).toBe("Tracked initiative");

      const updatedEdgeType = await client.callTool({
        name: "update_edge_type",
        arguments: { id: "supports", description: "Support relationship" },
      });
      expect((updatedEdgeType.structuredContent as { record: { description?: string } }).record.description).toBe("Support relationship");

      const deletedEdgeType = await client.callTool({
        name: "delete_edge_type",
        arguments: { id: "supports" },
      });
      expect((deletedEdgeType.structuredContent as { deletedId: string }).deletedId).toBe("supports");

      const deletedNodeType = await client.callTool({
        name: "delete_node_type",
        arguments: { id: "initiative" },
      });
      expect((deletedNodeType.structuredContent as { deletedId: string }).deletedId).toBe("initiative");
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    }
  });
});
