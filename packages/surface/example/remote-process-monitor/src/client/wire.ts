/**
 * Client-side surface bundle. Same WebSocket-over-oRPC transport as the
 * notes app — the only thing different about this app is what's at the
 * other end of the parent server (a remote stdio link instead of an
 * in-process store).
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { surfaceClient } from "@kolu/surface/solid";
import { WebSocket as PartySocket } from "partysocket";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws as unknown as WebSocket });
