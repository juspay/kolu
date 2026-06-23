/**
 * Client-side surface bundle — one WebSocket per host.
 *
 * Each host gets its own `surfaceClient` over its own `PartySocket` (the
 * reconnecting `WebSocket` from partysocket — kolu/drishti's shared transport),
 * cached so a Solid component remount doesn't tear down the live connection,
 * only the subscriptions inside it. drishti's `wire.ts` pattern, stripped of the
 * admin-surface + `pid`-echo machinery R4.8a doesn't need (no admin surface, no
 * stale-tab handshake on the client side yet — the parent gate is harmless to a
 * client that never sends `pid`).
 */

import { WebSocket as PartySocket } from "partysocket";
import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceClient } from "@kolu/surface/solid";
import {
  type ArivuContract,
  terminalWorkspaceSurface,
} from "../shared/contract.ts";

/** Build the per-host base WS URL (no `pid` — R4.8a has no stale-tab echo). */
function wsUrlFor(host: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/rpc/ws?host=${encodeURIComponent(host)}`;
}

/** One host's live surface client + the socket backing it. */
type HostSurface = ReturnType<typeof buildHostSurface>;

function buildHostSurface(host: string) {
  // Cold start can take 30s+ while the parent provisions the agent over `nix
  // copy`, so the connect deadline is bumped well past partysocket's 4s default
  // — without this the socket flaps repeatedly during the first connect.
  // partysocket takes the URL provider as the FIRST positional arg (a string or
  // thunk), options second.
  const ws = new PartySocket(() => wsUrlFor(host), undefined, {
    connectionTimeout: 60_000,
    minReconnectionDelay: 2_000,
    maxReconnectionDelay: 15_000,
  });
  const client = surfaceClient(
    terminalWorkspaceSurface,
    websocketLink<ArivuContract>(ws as unknown as WebSocket),
  );
  return { ws, client };
}

const cache = new Map<string, HostSurface>();

/** Get the (cached) surface client for `host`. The first call opens the
 *  PartySocket; later calls return the same instance so a tab remount preserves
 *  the live connection. */
export function surfaceForHost(host: string): HostSurface["client"] {
  let entry = cache.get(host);
  if (entry === undefined) {
    entry = buildHostSurface(host);
    cache.set(host, entry);
  }
  return entry.client;
}
