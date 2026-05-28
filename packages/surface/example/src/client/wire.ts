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

import { surfaceClient } from "@kolu/surface/solid";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws as unknown as WebSocket });
