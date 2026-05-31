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
import { surface } from "../common/surface";

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

export const app = surfaceClient(
  surface,
  websocketLink<typeof surface.contract>(ws as unknown as WebSocket),
);
