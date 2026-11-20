import { serveSurfaceAsMcp } from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { KOLU_FLEET_EXPOSE } from "../expose.ts";
import { assertFleetFaceComplete, fleetClientFace } from "./face.ts";
import { fleetSurface } from "./fleetSurface.ts";
import type { FleetHosts } from "./hosts.ts";
import { koluFleetTools } from "./lift.ts";
import type { FleetWorks } from "./works.ts";

export interface ServeKoluFleetMcpOptions {
  /** kolu-server's host map, as this face reads it. */
  hosts: FleetHosts;
  /** Where the face answers. REQUIRED — a fleet face has no obvious door, and
   *  a silent stdio default would have the one server a conversation depends
   *  on quietly talking to nobody. */
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
}

export async function serveKoluFleetMcp(
  opts: ServeKoluFleetMcpOptions,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const client = fleetClientFace(opts.hosts, opts.works);
  assertFleetFaceComplete(client);
  return serveSurfaceAsMcp({
    core: { surface: fleetSurface, expose: KOLU_FLEET_EXPOSE },
    client: () => ({ core: client }),
    tools: koluFleetTools(opts.hosts, opts.works),
    serverInfo: opts.serverInfo,
    transport: opts.transport,
  });
}
