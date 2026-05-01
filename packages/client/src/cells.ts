/**
 * Transport setup: a single WebSocket connection (auto-reconnecting via
 * partysocket) feeding `@kolu/cells/solid`'s `createCellsClient` to
 * produce the typed oRPC client. The framework owns retry plugin
 * installation and `STREAM_RETRY` context threading; this file just
 * constructs the wire and re-exports the bound `client`.
 *
 * App code:
 *
 *   - For Cell/Collection/Stream descriptors → `useCell` /
 *     `useCollection` / `useStream` from `@kolu/cells/solid`. Hooks
 *     accept procedure refs (e.g. `client.preferences.get`) and thread
 *     `STREAM_RETRY` internally.
 *   - For raw streaming RPCs (terminal `attach`, lifecycle `onExit`) →
 *     `streamCall(client.X.Y, input, { signal, onRetry? })`. Same retry
 *     context, escape hatch for shapes outside the three primitives.
 *   - For mutations and one-shot queries → call `client.X.Y(input)`
 *     directly. The retry plugin's default `retry: 0` fails them fast.
 *
 * Lifecycle observation (transport status, server identity, the
 * `server.info()` probe distinguishing reconnect vs restart) lives in
 * `./rpc/rpc` — it reads this `ws` + `client`.
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
export const { client } = createCellsClient<typeof contract>({
  websocket: ws as unknown as WebSocket,
});
