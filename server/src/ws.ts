import type { WSContext } from "hono/ws";
import type { PtyHandle } from "./pty.ts";
import { getScrollbackSnapshot, writePty, resizePty } from "./pty.ts";
import type { WsClientMessage } from "kolu-common";

export function handleWs(handle: PtyHandle) {
  return {
    onOpen(_event: Event, ws: WSContext) {
      // Replay scrollback
      const snapshot = getScrollbackSnapshot(handle);
      if (snapshot.length > 0) {
        ws.send(snapshot);
      }

      // Register for broadcast
      const client = {
        send: (data: Buffer | string) => {
          try {
            ws.send(data);
          } catch {
            // client disconnected
          }
        },
      };
      handle.clients.add(client);

      // Store client ref for cleanup
      (ws as any).__client = client;
    },

    onMessage(event: MessageEvent, ws: WSContext) {
      const data = event.data;

      if (typeof data === "string") {
        // Try to parse as JSON control message
        try {
          const msg: WsClientMessage = JSON.parse(data);
          if (msg.type === "Resize") {
            resizePty(handle, msg.cols, msg.rows);
            return;
          }
        } catch {
          // Not JSON, treat as raw input
        }
        // Forward as raw PTY input
        writePty(handle, data);
      } else if (data instanceof ArrayBuffer) {
        writePty(handle, Buffer.from(data).toString("utf-8"));
      } else if (data instanceof Uint8Array) {
        writePty(handle, Buffer.from(data).toString("utf-8"));
      }
    },

    onClose(_event: CloseEvent, ws: WSContext) {
      const client = (ws as any).__client;
      if (client) {
        handle.clients.delete(client);
      }
    },

    onError(_event: Event, ws: WSContext) {
      const client = (ws as any).__client;
      if (client) {
        handle.clients.delete(client);
      }
    },
  };
}
