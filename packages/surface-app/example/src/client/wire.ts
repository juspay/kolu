/**
 * The one connection: `connectSurfaces` — the turnkey seam for several sibling
 * surfaces over ONE reconnecting wire.
 *
 * `clients.surfaceApp` is the control-plane client (the `buildInfo` cell);
 * `clients.demo` carries the live `serverStats` cell. `conn.link.wire` is the
 * watchable transport the connection lifecycle is derived from in `App.tsx`.
 *
 * This used to hand-build the three pieces — `websocketLink` → `createLiveSignal`
 * → `surfaceClients` — and that is exactly why it is worth reading now: the
 * hand-built path dialled a wire with NO `pid` echo, so this example's own server
 * gate (`acceptSurfaceSocket` in `server/main.ts`) could never reject anything,
 * and the code people copy taught the omission. `connectSurfaces` owns the whole
 * handshake: it probes the framework-reserved `system/identity` on every open,
 * feeds the echo its URL thunk appends, and REQUIRES the `retired` policy below
 * for the rejection that earns.
 */

import { connectSurfaces } from "@kolu/surface-app/solid";
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";
import { surfaces } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

export const conn = await connectSurfaces({
  surfaces,
  url: wsUrl,
  // The server retired this tab: it is bound to a process that is gone, the link
  // will never dial again, and every call on it now fails. There is no default
  // for this and there cannot be one — the option exists so that a wire which
  // compiles has an answer. This example takes the simplest honest one: land the
  // deployed build. An app that would rather let the reader choose passes its own
  // handler and takes the screen instead.
  retired: reloadForUpdate,
});

export const clients = conn.clients;
