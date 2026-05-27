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

// Vite HMR re-evaluates this module on edits — without this dispose
// hook each reload leaks a PartySocket (and the parent server logs a
// fresh `browser ws connect` every time a client file is saved).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    ws.close();
  });
}

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws as unknown as WebSocket });
