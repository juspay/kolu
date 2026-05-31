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
import { surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const app = surfaceClient(
  surface,
  websocketLink<typeof surface.contract>(ws as unknown as WebSocket),
);
