/**
 * Surface client bundle. One websocket link carries BOTH sibling surfaces;
 * `surfaceClients` splits it into a per-key client bundle. `clients.surfaceApp`
 * is the control-plane client (buildInfo + the `identity.info` probe);
 * `clients.demo` carries the live `serverStats` cell. `ws` is the raw transport —
 * surface-app derives the connection lifecycle from `ws` + the `identity.info`
 * probe (passed to <SurfaceAppProvider> in App.tsx).
 */

import { createLiveSignal, surfaceClients } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { type contract, surfaces } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

// `createLiveSignal` builds the combined oRPC link over `ws` AND wires the half-open
// watchdog (probing `system.live` on the `surfaceApp` sibling's slice of that link —
// anchored to the socket it reconnects) AND bundles it with the branded `live` the
// clients require. Pass the WHOLE handle to `surfaceClients`: one combined link over
// the `{ surface: { surfaceApp, demo } }` contract, split into per-key clients (each
// resolving at `/surface/<key>/<prim>/<verb>`). This seam OWNS the watchdog over the
// admin socket, so `App.tsx` passes `heartbeat={false}` to `<SurfaceAppProvider>` (its
// lifecycle observes the same socket but doesn't double-watch it).
const transport = createLiveSignal<typeof contract>(ws, {
  siblingKey: "surfaceApp",
});
export const clients = surfaceClients(transport, surfaces);
