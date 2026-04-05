/** oRPC client — single WebSocket connection to the example server. */

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "../server.ts";

type Client = ContractRouterClient<typeof contract>;

const { protocol, host } = window.location;
const ws = new WebSocket(
  `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`,
);
const link = new RPCLink({ websocket: ws });

export const client = createORPCClient<Client>(link);
