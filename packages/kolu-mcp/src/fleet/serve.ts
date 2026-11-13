/**
 * `serveKoluFleetMcp` — the kolu MCP face over a FLEET: `fleetSurface`
 * re-exposed through `@kolu/surface-mcp`, curated by the same tool list the
 * stdio face serves ({@link KOLU_FLEET_EXPOSE}) plus the lifted bespoke tools.
 *
 * It is the sibling of `serveKoluMcp` and differs in exactly three places:
 * the surface it stands on, the expose map's RESOURCE rows (see
 * `../expose.ts`), and where the client comes from. The stdio face is handed a
 * `connect` factory because it dials a socket that can drop; this one is handed
 * a HOST PORT and builds its client in-process, because there is no transport
 * under it — each member reaches the hosts kolu-server already holds. So there
 * is no redial hook here and nothing to dispose on a drop: a host dropping is
 * an event in the roster, not a dead connection, and it is already this face's
 * vocabulary (a refusal by name, a `gone` event, a row that goes `failed`).
 *
 * The TRANSPORT is required rather than defaulted. The stdio face's default is
 * stdio because `kolu mcp` IS a stdio program; a fleet face has no such
 * obvious door — kolu-server hands it a streamable-HTTP transport on a
 * loopback listener — and a silent stdio default would have the one server a
 * conversation depends on quietly talking to nobody.
 */

import { serveSurfaceAsMcp } from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { KOLU_FLEET_EXPOSE } from "../expose.ts";
import { assertFleetFaceComplete, fleetClientFace } from "./face.ts";
import { fleetSurface } from "./fleetSurface.ts";
import type { FleetHosts } from "./hosts.ts";
import { koluFleetTools } from "./lift.ts";
import type { FleetWatchList } from "./watchList.ts";

export interface ServeKoluFleetMcpOptions {
  /** kolu-server's host map, as this face reads it. */
  hosts: FleetHosts;
  /** Where the face answers. REQUIRED — see the module header. */
  transport: Transport;
  /** The `serverInfo` the MCP host sees. REQUIRED for the reason the stdio
   *  face's is: a baked fallback would let the one server a conductor
   *  depends on report a version that is not the product's. */
  serverInfo: { name: string; version: string };
  /** The conductor's watch list — what kolu-server wakes it about. REQUIRED,
   *  and a PORT for the same reason `hosts` is: the list is persisted with the
   *  conversation and read by the server's watcher, so a copy held here would
   *  be a second answer to "what is being watched". `lifecycle_create` adds
   *  what it creates; `watch_terminal` / `unwatch_terminal` are the agent's
   *  own door to it, and the `watched` resource is how it reads the list back
   *  without moving it. */
  watchList: FleetWatchList;
}

export async function serveKoluFleetMcp(
  opts: ServeKoluFleetMcpOptions,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const client = fleetClientFace(opts.hosts, opts.watchList);
  assertFleetFaceComplete(client);
  return serveSurfaceAsMcp({
    // The degenerate rooted bundle, exactly as the stdio face serves: one core
    // and no siblings, so every tool name and every `surface://` URI is the
    // plain member name an agent already knows from `kolu mcp`.
    core: { surface: fleetSurface, expose: KOLU_FLEET_EXPOSE },
    client: () => ({ core: client }),
    tools: koluFleetTools(opts.hosts, opts.watchList),
    serverInfo: opts.serverInfo,
    transport: opts.transport,
  });
}
