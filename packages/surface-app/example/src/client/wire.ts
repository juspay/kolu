/**
 * Surface client bundle. One websocket link carries BOTH sibling surfaces;
 * `surfaceClients` splits it into a per-key client bundle. `clients.surfaceApp`
 * is the control-plane client (buildInfo + the `identity.info` probe);
 * `clients.demo` carries the live `serverStats` cell. `ws` is the raw transport —
 * surface-app derives the connection lifecycle from `ws` + the `identity.info`
 * probe (passed to <SurfaceAppProvider> in App.tsx).
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClients } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { type contract, surfaces } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

// One combined link over the `{ surface: { surfaceApp, demo } }` contract, split
// into per-key clients. Each client's `.rpc` is the SCOPED link slice
// (`{ surface: link.surface[key] }`), so a primitive reached through it resolves
// at `/surface/<key>/<prim>/<verb>` — the wire path `implementSurfaces` serves.
const link = websocketLink<typeof contract>(ws as unknown as WebSocket);
export const clients = surfaceClients(link, surfaces);
