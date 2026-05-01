/**
 * One PartySocket connection feeding `createCellsClient` to produce the
 * typed oRPC `client` for the whole app. Lifecycle observation
 * (transport status, server identity) lives in `./rpc/rpc`.
 */

import { createCellsClient } from "@kolu/cells/solid";
import type { contract } from "kolu-common/contract";
import { WebSocket as PartySocket } from "partysocket";

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

export const ws = new PartySocket(wsUrl);

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

// PartySocket is API-compatible with WebSocket but the types don't overlap.
export const client = createCellsClient<typeof contract>({
  websocket: ws as unknown as WebSocket,
});
