import type { WSContext } from "hono/ws";
import type { PtyHandle, PtyClient } from "./pty.ts";
import type { WsClientMessage } from "kolu-common";

const clientMap = new WeakMap<WSContext, PtyClient>();

function removeClient(handle: PtyHandle, ws: WSContext) {
  const client = clientMap.get(ws);
  if (client) {
    handle.clients.delete(client);
    clientMap.delete(ws);
  }
}

export function handleWs(handle: PtyHandle) {
  return {
    onOpen(_event: Event, ws: WSContext) {
      const snapshot = handle.getScrollback();
      if (snapshot.length > 0) ws.send(snapshot);

      const client: PtyClient = {
        send: (data) => {
          try {
            ws.send(data);
          } catch {
            // client disconnected
          }
        },
      };
      handle.clients.add(client);
      clientMap.set(ws, client);
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
      removeClient(handle, ws);
    },

    onError(_event: Event, ws: WSContext) {
      removeClient(handle, ws);
    },
  };
}
