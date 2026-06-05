/**
 * Surface client bundle. `app` is the control-plane surface client; `ws` is the
 * raw transport. surface-app derives the connection lifecycle from `ws` + the
 * `surfaceApp.info` probe (passed to <SurfaceAppProvider> in App.tsx) — the example
 * no longer hand-derives a connection status.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const app = surfaceClient(
  surface,
  websocketLink<typeof surface.contract>(ws as unknown as WebSocket),
);
