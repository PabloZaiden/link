export interface GraphChangeEvent {
  type: "graph.changed";
  version: number;
  recordType: string;
  recordId: string;
  operation: string;
}

export class RealtimeHub {
  private clients = new Set<ServerWebSocket<unknown>>();

  websocket = {
    open: (ws: ServerWebSocket<unknown>) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: "graph.connected" }));
    },
    close: (ws: ServerWebSocket<unknown>) => {
      this.clients.delete(ws);
    },
    message: (ws: ServerWebSocket<unknown>, message: string | Buffer) => {
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

