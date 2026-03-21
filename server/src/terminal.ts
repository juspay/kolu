/**
 * Terminal session: PTY lifecycle + WebSocket client management.
 *
 * Bridges PTY I/O to connected WebSocket clients.
 */
import type { WSContext } from "hono/ws";
import { spawnPty, type PtyHandle } from "./pty.ts";
import type { WsClientMessage, WsServerMessage } from "kolu-common";

/** A connected WebSocket client that can receive data. */
interface WsClient {
  send(data: Buffer | string): void;
}

/** Maps WSContext → WsClient for cleanup on disconnect. */
const wsMap = new WeakMap<WSContext, WsClient>();

const clients = new Set<WsClient>();

function broadcast(data: Buffer | string) {
  for (const client of clients) client.send(data);
}

function removeClient(ws: WSContext) {
  const client = wsMap.get(ws);
  if (client) {
    clients.delete(client);
    wsMap.delete(ws);
  }
}

/** Spawn a PTY and wire its output to connected WS clients. */
export function createTerminalSession(): PtyHandle {
  return spawnPty({
    onData: (data) => broadcast(data),
    onExit: (code) => {
      const msg: WsServerMessage = { type: "Exit", exit_code: code };
      broadcast(JSON.stringify(msg));
    },
  });
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
