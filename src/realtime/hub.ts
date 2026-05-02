import type { ServerWebSocket } from "bun";

export interface GraphChangeEvent {
  type: "graph.changed";
  version: number;
  recordType: string;
  recordId: string;
  operation: string;
}

export class RealtimeHub {
  private clients = new Set<ServerWebSocket<undefined>>();

  websocket = {
    open: (ws: ServerWebSocket<undefined>) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: "graph.connected" }));
    },
    close: (ws: ServerWebSocket<undefined>) => {
      this.clients.delete(ws);
    },
    message: (ws: ServerWebSocket<undefined>, message: string | Buffer) => {
      if (String(message) === "ping") ws.send("pong");
    },
  };

  broadcast(event: GraphChangeEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      client.send(payload);
    }
  }
}

