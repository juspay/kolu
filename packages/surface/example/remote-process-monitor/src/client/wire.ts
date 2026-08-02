/// <reference types="vite/client" />
/**
 * Client-side surface bundle. Same WebSocket transport as the notes app —
 * the only thing different about this app is what's at the other end of the
 * parent server (a remote stdio link instead of an in-process store).
 *
 * A real app reaches for the turnkey `connectSurface` (`@kolu/surface-app`),
 * which wires all of this in one call; this example hand-builds it to show the
 * raw seam — but NOT off a bare open/close signal. A websocket can silently
 * HALF-OPEN (the socket stays `open` while no bytes flow), so an open/close-only
 * `live` reads `true` forever over a dead link (the #1564 green-over-a-dead-link
 * lie), and `surfaceClient` REFUSES a bare wire dispatch. The only shape it
 * accepts over a websocket is a watchdog-backed `LiveSignalHandle`, and
 * `createLiveSignal` is the one minter — hand it the WHOLE `{ dispatch, wire }`
 * pairing `websocketLink` minted together, so the watchdog provably probes the
 * transport it reconnects.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClient } from "@kolu/surface/solid";
import { createLiveSignal } from "@kolu/surface-app/solid";
import { monitorSurface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

// During cold start the parent is busy provisioning the agent on the remote (a
// remote-store Nix build plus root commit — easily 30+ seconds on first run), so
// the link may sit un-dialled for a while. That is fine: the link's reconnect
// schedule backs off on its own (exponential from 500ms, capped at 5s) and there
// is no connect deadline to trip — the reconnect-storm the old partysocket
// defaults produced has no spelling here.
export const link = await websocketLink({
  group: monitorSurface.group,
  url: () => wsUrl,
  // This parent never retires a tab, so every close is an ordinary drop the
  // link re-dials through.
  isTerminalClose: () => false,
});

const transport = createLiveSignal(link, {});

// Vite HMR re-evaluates this module on edits — without this dispose hook each
// reload leaks a link and its watchdog (and the parent server logs a fresh
// `browser ws connect` every time a client file is saved).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    transport.dispose();
    void link.dispose();
  });
}

export const app = surfaceClient(monitorSurface, transport);
