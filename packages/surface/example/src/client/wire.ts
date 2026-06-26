/**
 * One-time setup: build the surface client bundle. `surfaceClient` walks
 * the surface once and exposes:
 *
 *   - `app.cells / .collections / .streams / .events` — bound `.use()`
 *     hooks with `source` / `mutate` / `valueSource` / `keyToInput`
 *     pre-filled.
 *   - `app.rpc` — typed oRPC client for imperative procedures
 *     (`app.rpc.notes.create({...})`) and any verb the bound hooks
 *     don't cover.
 */

import { createLiveSignal, surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

// A websocket CAN silently half-open, so `surfaceClient` requires a watchdog-backed
// `{ live }` — minted here by `createLiveSignal`, which also BUILDS the oRPC link
// over `ws` (so the watchdog probes the socket it reconnects) and brands the signal.
// Build the client over `transport.link`. `createLiveSignal` lives in
// `@kolu/surface`, so this minimal example needs no `@kolu/surface-app` dependency.
const transport = createLiveSignal<typeof surface.contract>(ws, {});

export const app = surfaceClient(surface, transport.link, {
  live: transport.live,
});
