/// <reference types="vite/client" />
/**
 * Client surface bundle — `surfaceClient` over a live WebSocket.
 *
 * `createLiveSignal` builds the oRPC link over `ws` AND wires the half-open
 * heartbeat (a websocket can stay `open` while no bytes flow — the
 * green-over-a-dead-link lie), bundling both into the watchdog-backed handle
 * `surfaceClient` requires. It lives in `@kolu/surface`, so this part needs no
 * `@kolu/surface-app` dependency.
 *
 * The result — `app.cells.load`, `app.cells.memory`, `app.collections.processes`,
 * `app.rpc.surface.process.kill` — is the exact shape `directLink` gave us
 * in-process (`inproc.ts`); only the transport changed.
 */

import { createLiveSignal, surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

const transport = createLiveSignal<typeof surface.contract>(ws, {});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    ws.close();
  });
}

export const app = surfaceClient(surface, transport);
