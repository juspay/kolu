/// <reference types="vite/client" />
/**
 * Client — connect to the surface MAP over one WebSocket.
 *
 * `connectSurfaceMap(map, transport)` gives the whole fleet through one object:
 *   - `app.entries`      — the ONE membership authority (the chip strip).
 *   - `app.entry(host)`  — a pure per-host lens (its `state()`, its cells…).
 *   - `app.useEntry(sig)` — the Solid re-keying lens the canvas follows.
 *
 * The link is built over the MAP's group (`hostMap.group` — the map's own flat
 * tag namespace, folding `{ mapKey }` into every entry-member call), and the
 * transport is the watchdog-backed handle `createLiveSignal` mints: a websocket
 * can silently half-open, so each chip floors its status on the real transport
 * liveness (`app.live`) and never paints green over a dead link.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { createLiveSignal } from "@kolu/surface/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
import { hostMap } from "../common/map";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

export const link = await websocketLink({
  group: hostMap.group,
  url: () => wsUrl,
  isTerminalClose: () => false,
});

const transport = createLiveSignal(link, {});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    void link.dispose();
  });
}

export const app = connectSurfaceMap(hostMap, transport);
