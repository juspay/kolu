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
import type { FleetMemory } from "./memory.ts";
import type { FleetWorks } from "./works.ts";

export interface ServeKoluFleetMcpOptions {
  /** kolu-server's host map, as this face reads it. */
  hosts: FleetHosts;
  /** Where the face answers. REQUIRED — see the module header. */
  transport: Transport;
  /** The `serverInfo` the MCP host sees. REQUIRED for the reason the stdio
   *  face's is: a baked fallback would let the one server a conductor
   *  depends on report a version that is not the product's. */
  serverInfo: { name: string; version: string };
  /** KOLU'S PIECES OF WORK — what the conductor opens, joins terminals to and
   *  is woken about. REQUIRED, and a PORT for the same reason `hosts` is: the
   *  works are stored with the rest of kolu's state and read by the server's
   *  watcher, so a copy held here would be a second answer to "what is being
   *  run". `lifecycle_create` puts what it creates into one; `work_open`,
   *  `work_ask`, `work_adopt`, `work_leave` and `work_note` are the agent's
   *  own door to them, and the `works` resource is how it reads them back
   *  without moving anything. */
  works: FleetWorks;
  /** THE CONDUCTOR'S MEMORY — a PORT for the same reason: kolu-server
   *  stores it, and only the human changes it. `memory_propose` asks, and
   *  the `memory` resource reads it back. */
  memory: FleetMemory;
}

export async function serveKoluFleetMcp(
  opts: ServeKoluFleetMcpOptions,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const client = fleetClientFace(opts.hosts, opts.works, opts.memory);
  assertFleetFaceComplete(client);
  return serveSurfaceAsMcp({
    // The degenerate rooted bundle, exactly as the stdio face serves: one core
    // and no siblings, so every tool name and every `surface://` URI is the
    // plain member name an agent already knows from `kolu mcp`.
    core: { surface: fleetSurface, expose: KOLU_FLEET_EXPOSE },
    client: () => ({ core: client }),
    tools: koluFleetTools(opts.hosts, opts.works, opts.memory),
    serverInfo: opts.serverInfo,
    transport: opts.transport,
  });
}
