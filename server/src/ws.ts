/**
 * WebSocket ↔ PTY bridge.
 *
 * Manages connected WS clients, broadcasts PTY output,
 * and routes client input (keystrokes, resize) to the PTY.
 */
import type { WSContext } from "hono/ws";
import type { PtyHandle } from "./pty.ts";
import type { WsClientMessage } from "kolu-common";

/** A connected WebSocket client that can receive data. */
interface WsClient {
  send(data: Buffer | string): void;
}

/** Maps WSContext → WsClient for cleanup on disconnect. */
const wsMap = new WeakMap<WSContext, WsClient>();

/** All currently connected clients. */
export const clients = new Set<WsClient>();

/** Send data to all connected clients. */
export function broadcast(data: Buffer | string) {
  for (const client of clients) client.send(data);
}

function removeClient(ws: WSContext) {
  const client = wsMap.get(ws);
  if (client) {
    clients.delete(client);
    wsMap.delete(ws);
  }
}

/** Hono WebSocket handler: replays scrollback, bridges I/O to PTY. */
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
