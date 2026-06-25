/// <reference types="vite/client" />
/**
 * Client-side surface bundle. Same WebSocket-over-oRPC transport as the
 * notes app — the only thing different about this app is what's at the
 * other end of the parent server (a remote stdio link instead of an
 * in-process store).
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { createSignal } from "solid-js";
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

// Vite HMR re-evaluates this module on edits — without this dispose
// hook each reload leaks a PartySocket (and the parent server logs a
// fresh `browser ws connect` every time a client file is saved).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    ws.close();
  });
}

// Transport liveness for `app.health().live`. A real app reaches for the
// turnkey `connectSurface` (`@kolu/surface-app`), which derives this from the
// socket AND runs a half-open heartbeat for free; this example hand-builds
// `surfaceClient + websocketLink` to show the raw seam, so it must thread its
// own `{ live }` — without it `health().live` is a constant `true` and a dead
// socket reads as live. Flip a signal off the socket's own open/close.
const [isLive, setIsLive] = createSignal(false);
ws.addEventListener("open", () => setIsLive(true));
ws.addEventListener("close", () => setIsLive(false));

export const app = surfaceClient(
  monitorSurface,
  websocketLink<typeof monitorSurface.contract>(ws as unknown as WebSocket),
  { live: () => isLive() },
);
