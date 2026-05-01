/**
 * One-time setup: build the matrix client bundle. `matrixClient` walks
 * the matrix once and produces `.cells / .collections / .streams /
 * .events` whose `.use(policy)` hooks have `source`/`mutate`/`valueSource`/
 * `keyToInput` pre-bound. Imperative procedures stay accessible via
 * `cells.rpc.<ns>.<verb>(...)`.
 */

import { matrixClient } from "@kolu/cells/solid";
import { WebSocket as PartySocket } from "partysocket";
import { matrix } from "../common/cells";
import type { contract } from "../common/contract";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const cells = matrixClient<
  typeof matrix.spec,
  ContractRouterClient<typeof contract, ClientRetryPluginContext>
>(matrix, { websocket: ws as unknown as WebSocket });

/** Convenience alias for the typed RPC client. Use this for imperative
 *  procedures (`client.notes.create({...})`) and any verb the bound
 *  `.use()` hooks don't cover (e.g. mutation refs called outside Solid
 *  reactive context). */
export const client = cells.rpc;
