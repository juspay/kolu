/**
 * One-time setup: build the typed oRPC client wired through
 * `@kolu/cells/solid`'s `createCellsClient`. The framework owns retry-
 * plugin installation and `STREAM_RETRY` context plumbing; we just
 * supply the websocket and contract type.
 */

import { createCellsClient } from "@kolu/cells/solid";
import { WebSocket as PartySocket } from "partysocket";
import type { contract } from "../common/contract";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new PartySocket(wsUrl);

export const client = createCellsClient<typeof contract>({
  websocket: ws as unknown as WebSocket,
});
