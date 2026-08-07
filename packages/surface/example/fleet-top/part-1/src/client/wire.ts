/// <reference types="vite/client" />
/**
 * Client surface bundle — `surfaceClient` over a live WebSocket.
 *
 * Two steps. `websocketLink` DIALS: it owns the socket, the reconnect schedule,
 * and a URL thunk re-evaluated on every re-dial. Then `createLiveSignal` takes
 * the WHOLE `{ dispatch, wire }` the link minted together and adds the half-open
 * watchdog — a websocket can stay `open` while no bytes flow (the
 * green-over-a-dead-link lie), so `surfaceClient` REFUSES a bare wire dispatch
 * and takes only this watchdog-backed handle. Both live in `@kolu/surface`, so
 * this part needs no `@kolu/surface-app` dependency on the client side.
 *
 * The result — `app.cells.load`, `app.cells.memory`, `app.collections.processes`,
 * `app.procedures.process.kill` — is the exact surface `directDispatch` gave us
 * in-process (`inproc.ts`); only the transport changed.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { createLiveSignal, surfaceClient } from "@kolu/surface/solid";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

export const link = await websocketLink({
  group: surface.group,
  url: () => wsUrl,
  // No close code retires this wire — every drop is transient, so the link
  // re-dials through all of them.
  isTerminalClose: () => false,
});

const transport = createLiveSignal(link, {});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    void link.dispose();
  });
}

export const app = surfaceClient(surface, transport);
