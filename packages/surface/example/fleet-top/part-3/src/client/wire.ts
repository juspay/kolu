/// <reference types="vite/client" />
/**
 * Client — connect to the surface MAP over one WebSocket.
 *
 * `connectSurfaceMap(map, transport)` gives the whole fleet through one object:
 *   - `app.entries`      — the ONE membership authority (the chip strip).
 *   - `app.entry(host)`  — a pure per-host lens (its `state()`, its cells…).
 *   - `app.useEntry(sig)` — the Solid re-keying lens the canvas follows.
 *
 * The transport is the watchdog-backed handle `createLiveSignal` mints — a
 * websocket can silently half-open, so each chip floors its status on the real
 * transport liveness (`app.live`) and never paints green over a dead link.
 */

import { createLiveSignal } from "@kolu/surface/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
import { WebSocket as PartySocket } from "partysocket";
import { hostMap } from "../common/map";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl, undefined, {
  connectionTimeout: 60_000,
  minReconnectionDelay: 2_000,
  maxReconnectionDelay: 15_000,
});

const transport = createLiveSignal<typeof hostMap.contract>(ws, {});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    ws.close();
  });
}

export const app = connectSurfaceMap(hostMap, transport);
