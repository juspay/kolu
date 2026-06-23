/**
 * Client-side surface bundle — one WebSocket per host.
 *
 * Each host gets its own `surfaceClient` over its own reconnecting socket, cached
 * so a Solid component remount doesn't tear down the live connection, only the
 * subscriptions inside it. drishti's `wire.ts` pattern: the per-host sockets are
 * built through `@kolu/surface-app/connect`'s `createSurfaceSocket`, sharing ONE
 * `ProcessIdEcho` so every (re)connect carries the `?pid=` stale-tab token and a
 * server stale-close retires the socket.
 *
 * The stale-tab handshake, end to end (R4.8a has no admin/identity surface, so
 * the echo is fed from the one-shot `/api/hosts` fetch, not a live lifecycle):
 *
 *   1. The app fetches `/api/hosts`, which carries this server's `processId`, and
 *      calls `rememberServerProcessId(processId)` BEFORE any `<HostGroup>` (and
 *      thus any `surfaceForHost`) renders — so the echo is populated before the
 *      first socket is built.
 *   2. Each per-host socket appends `?pid=<that processId>` on every (re)connect
 *      (the URL is a thunk re-read by partysocket each time).
 *   3. After a PARENT restart the live `processId` changes; a tab still carrying
 *      the old one is rejected by the server's `gateStaleSocket` with the
 *      stale-close code, and `retireOnStaleClose` tears the socket down so neither
 *      partysocket's offline buffer nor oRPC's pending peers grow. A page reload
 *      re-fetches the fresh `processId` and reconnects cleanly.
 *
 *  The first-ever connect (before any `processId` is observed) omits `pid` and
 *  always passes the gate — exactly the contract `createProcessIdEcho` encodes.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClient } from "@kolu/surface/solid";
import {
  createProcessIdEcho,
  createSurfaceSocket,
} from "@kolu/surface-app/connect";
import {
  type ArivuContract,
  terminalWorkspaceSurface,
} from "../shared/contract.ts";

/** The shared `pid` echo every per-host socket reads. One instance for the whole
 *  app (all hosts dial the SAME server, so they echo ONE identity), populated by
 *  `rememberServerProcessId` from the `/api/hosts` fetch. */
const processIdEcho = createProcessIdEcho();

/** Record the server's `processId` (from `/api/hosts`) so every per-host socket
 *  echoes it as `?pid=` on (re)connect. Call this BEFORE rendering any
 *  `<HostGroup>` so the echo is set before the first socket opens — the app's
 *  fetch-then-render order guarantees that. */
export function rememberServerProcessId(processId: string): void {
  processIdEcho.remember(processId);
}

/** Build the per-host base WS URL. The `?pid=` token is appended by the echo, so
 *  it's NOT added here. */
function wsUrlFor(host: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/rpc/ws?host=${encodeURIComponent(host)}`;
}

/** One host's live surface client + the socket backing it. */
type HostSurface = ReturnType<typeof buildHostSurface>;

function buildHostSurface(host: string) {
  // Cold start can take 30s+ while the parent provisions the agent over `nix
  // copy`, so the connect deadline is bumped well past partysocket's 4s default
  // — without this the socket flaps repeatedly during the first connect. The URL
  // thunk re-reads the shared echo each reconnect (how a tab re-presents its now-
  // stale `pid` and is re-rejected), and `retireOnStaleClose` retires the socket
  // when the server closes it as stale (no lifecycle watches these sockets).
  const { ws } = createSurfaceSocket({
    url: () => wsUrlFor(host),
    echo: processIdEcho,
    socketOptions: {
      connectionTimeout: 60_000,
      minReconnectionDelay: 2_000,
      maxReconnectionDelay: 15_000,
    },
    retireOnStaleClose: true,
  });
  const client = surfaceClient(
    terminalWorkspaceSurface,
    websocketLink<ArivuContract>(ws as unknown as WebSocket),
  );
  return { ws, client };
}

const cache = new Map<string, HostSurface>();

/** Get the (cached) surface client for `host`. The first call opens the socket;
 *  later calls return the same instance so a tab remount preserves the live
 *  connection. */
export function surfaceForHost(host: string): HostSurface["client"] {
  let entry = cache.get(host);
  if (entry === undefined) {
    entry = buildHostSurface(host);
    cache.set(host, entry);
  }
  return entry.client;
}
