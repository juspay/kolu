/**
 * Surface client bundle. One websocket link carries BOTH sibling surfaces;
 * `surfaceClients` splits it into a per-key client bundle. `clients.surfaceApp`
 * is the control-plane client (buildInfo + the `identity.info` probe);
 * `clients.demo` carries the live `serverStats` cell. `ws` is the raw transport —
 * surface-app derives the connection lifecycle from `ws` + the `identity.info`
 * probe (passed to <SurfaceAppProvider> in App.tsx).
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { createLiveSignal, surfaceClients } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { type contract, surfaces } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

// One combined link over the `{ surface: { surfaceApp, demo } }` contract, split
// into per-key clients. Each client's `.rpc` is the SCOPED link slice
// (`{ surface: link.surface[key] }`), so a primitive reached through it resolves
// at `/surface/<key>/<prim>/<verb>` — the wire path `implementSurfaces` serves.
const link = websocketLink<typeof contract>(ws as unknown as WebSocket);
// A websocket CAN silently half-open, so `surfaceClients` requires a watchdog-backed
// `{ live }` — minted by `createLiveSignal` (the one minter: it wires the half-open
// heartbeat AND brands the signal). This seam OWNS the watchdog over the admin
// socket, so `App.tsx` passes `heartbeat={false}` to `<SurfaceAppProvider>` (its
// lifecycle observes the same socket but doesn't double-watch it).
const transport = createLiveSignal(ws, {
  // biome-ignore lint/suspicious/noExplicitAny: the combined link's per-sibling slice is walk-by-string.
  probe: () => probeSurfaceLive({ surface: (link as any).surface.surfaceApp }),
});
export const clients = surfaceClients(link, surfaces, { live: transport.live });
