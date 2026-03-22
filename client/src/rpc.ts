/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */
import { createSignal } from "solid-js";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { WebSocket as PartySocket } from "partysocket";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "kolu-common/contract";

export type WsStatus = "connecting" | "open" | "closed";

type Client = ContractRouterClient<typeof contract>;

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

const ws = new PartySocket(wsUrl);

// Track WebSocket connection status as a reactive signal
const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
ws.addEventListener("open", () => setWsStatus("open"));
ws.addEventListener("close", () => setWsStatus("closed"));

export { wsStatus };

// Cast: PartySocket is API-compatible with WebSocket but types don't overlap
const link = new RPCLink({ websocket: ws as unknown as WebSocket });

export const client = createORPCClient<Client>(link);
