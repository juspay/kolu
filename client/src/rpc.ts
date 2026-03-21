/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { WebSocket as PartySocket } from "partysocket";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "kolu-common/contract";

type Client = ContractRouterClient<typeof contract>;

function buildWsUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;
}

const websocket = new PartySocket(buildWsUrl());

const link = new RPCLink({
  websocket: websocket as unknown as WebSocket,
});

export const client = createORPCClient<Client>(link);
