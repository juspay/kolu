import type { WSContext } from "hono/ws";
import type { PtyHandle } from "./pty.ts";
import type { WsClientMessage, WsServerMessage } from "kolu-common";

interface WsClient {
  send(data: Buffer | string): void;
}

const wsMap = new WeakMap<WSContext, WsClient>();

export const clients = new Set<WsClient>();

export function broadcast(data: Buffer | string) {
  for (const client of clients) client.send(data);
}

export function broadcastExit(exitCode: number) {
  const msg: WsServerMessage = { type: "Exit", exit_code: exitCode };
  broadcast(JSON.stringify(msg));
}

function removeClient(ws: WSContext) {
  const client = wsMap.get(ws);
  if (client) {
    clients.delete(client);
    wsMap.delete(ws);
  }
}

export function handleWs(handle: PtyHandle) {
  return {
    onOpen(_event: Event, ws: WSContext) {
      const snapshot = handle.getScrollback();
      if (snapshot.length > 0) ws.send(snapshot);

      const client: WsClient = {
        send: (data) => {
          try {
            ws.send(data);
          } catch {
            // client disconnected
          }
        },
      };
      clients.add(client);
      wsMap.set(ws, client);
    },

    onMessage(event: MessageEvent) {
      const { data } = event;

      if (typeof data !== "string") {
        handle.write(Buffer.from(data as ArrayBuffer).toString("utf-8"));
        return;
      }

      try {
        const msg: WsClientMessage = JSON.parse(data);
        switch (msg.type) {
          case "Resize":
            handle.resize(msg.cols, msg.rows);
            return;
        }
      } catch {
        // Not JSON — raw terminal input
      }
      handle.write(data);
    },

    onClose(_event: CloseEvent, ws: WSContext) {
      removeClient(ws);
    },

    onError(_event: Event, ws: WSContext) {
      removeClient(ws);
    },
  };
}
