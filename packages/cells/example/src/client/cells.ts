/**
 * One-time setup: build the surface client bundle. `surfaceClient` walks
 * the surface once and produces `.cells / .collections / .streams /
 * .events` whose `.use(policy)` hooks have `source`/`mutate`/`valueSource`/
 * `keyToInput` pre-bound. Imperative procedures stay accessible via
 * `cells.rpc.<ns>.<verb>(...)`.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { surfaceClient } from "@kolu/cells/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/cells";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const cells = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws as unknown as WebSocket });

/** Convenience alias for the typed RPC client. Use this for imperative
 *  procedures (`client.notes.create({...})`) and any verb the bound
 *  `.use()` hooks don't cover (e.g. mutation refs called outside Solid
 *  reactive context). */
export const client = cells.rpc;
