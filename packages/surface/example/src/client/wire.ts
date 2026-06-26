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

import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { createLiveSignal, surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

// A websocket CAN silently half-open, so `surfaceClient` requires a watchdog-backed
// `{ live }` — minted here by `createLiveSignal` (the one minter: it wires the
// half-open heartbeat AND brands the signal). `createLiveSignal` lives in
// `@kolu/surface`, so this minimal example needs no `@kolu/surface-app` dependency.
const link = websocketLink<typeof surface.contract>(ws as unknown as WebSocket);
const { live } = createLiveSignal(ws, { probe: () => probeSurfaceLive(link) });

export const app = surfaceClient(surface, link, { live });
