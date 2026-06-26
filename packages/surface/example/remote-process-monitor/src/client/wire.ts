/// <reference types="vite/client" />
/**
 * Client-side surface bundle. Same WebSocket-over-oRPC transport as the
 * notes app — the only thing different about this app is what's at the
 * other end of the parent server (a remote stdio link instead of an
 * in-process store).
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { surfaceClient } from "@kolu/surface/solid";
import { createLiveSignal } from "@kolu/surface-app/solid";
import { WebSocket as PartySocket } from "partysocket";
import { monitorSurface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
// `partysocket`'s `WebSocket` export is `ReconnectingWebSocket`; its
// `(url, protocols, options)` ctor sets these defaults: connectionTimeout
// 4s, minUptime 5s, minReconnectionDelay 1–5s. During cold start the
// parent is busy provisioning the agent on the remote (`nix copy
// --derivation` + remote realise — easily 30+ seconds on first run), so
// the 4s deadline trips every connect, partysocket reopens a fresh ws,
// the parent logs a new `browser ws connect`, repeat 6+ times. Bump the
// deadlines to fit the expected provisioning window.
export const ws = new PartySocket(wsUrl, undefined, {
  connectionTimeout: 60_000,
  minReconnectionDelay: 2_000,
  maxReconnectionDelay: 15_000,
});

const link = websocketLink<typeof monitorSurface.contract>(
  ws as unknown as WebSocket,
);

// Transport liveness for `app.health().live`. A real app reaches for the turnkey
// `connectSurface` (`@kolu/surface-app`), which wires all of this for free; this
// example hand-builds `surfaceClient + websocketLink` to show the raw seam, so it
// mints the `{ live }` itself — but NOT off a bare open/close signal. A websocket
// can silently HALF-OPEN (the socket stays `open` while no bytes flow), so an
// open/close-only `live` reads `true` forever over a dead link (the #1564
// green-over-a-dead-link lie); `surfaceClient` REFUSES such a signal. The only
// `{ live }` it accepts over a websocket is a watchdog-backed `LiveSignal`, and
// `createLiveSignal` is the one minter — it derives the liveness accessor AND wires
// the half-open heartbeat (probing the framework-reserved `system.live` round-trip,
// forcing `ws.reconnect()` on a missed probe) in one call. So even the hand-built
// seam gets the real watchdog, instead of a signal that can't see a half-open link.
const transport = createLiveSignal(ws, {
  probe: () => probeSurfaceLive(link),
});

// Vite HMR re-evaluates this module on edits — without this dispose hook each
// reload leaks a PartySocket and its watchdog (and the parent server logs a fresh
// `browser ws connect` every time a client file is saved).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    ws.close();
  });
}

export const app = surfaceClient(monitorSurface, link, {
  live: transport.live,
});
