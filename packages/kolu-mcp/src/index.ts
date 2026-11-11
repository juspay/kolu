/**
 * kolu-mcp — the kolu MCP face, in its TWO projections.
 *
 *   - **`serveKoluMcp`** — one host, over stdio: a pure `padiSurface` client
 *     re-exposed to coding agents via `@kolu/surface-mcp`. This is what `kolu
 *     mcp` serves to an agent working INSIDE a terminal, and its terminal ids
 *     are bare.
 *   - **`serveKoluFleetMcp`** — every host, in kolu-server: the SAME tool list
 *     lifted over kolu-server's host map, where a terminal is `host/id`. This
 *     is what the one orchestrator conversation holds, over a loopback
 *     streamable-HTTP transport kolu-server owns.
 *
 * The manifest is the graduation fence: this package depends on padi/surface
 * packages ONLY — no kolu app package — so `kolu mcp` provably serves agents
 * with no kolu-server behind it (the second-frontend proof, headless leg). That
 * holds for the fleet face too: it takes kolu-server's host map through a PORT
 * ({@link FleetHosts}) rather than importing kolu-server, so the arrow still
 * points one way.
 */

// WHAT the injected factory must hand back — kolu's rooted bundle, padi as its
// core — and the one hop a bundle-root verb takes to reach padi through it.
export { type KoluSurfaceClients, padiOf } from "./bundleClient.ts";
export {
  KOLU_FLEET_EXPOSE,
  KOLU_MCP_DENIED,
  KOLU_MCP_EXPOSE,
} from "./expose.ts";
// The FLEET face: its contract, the port kolu-server implements, the identity
// grammar, and the serve function. The grammar is ALSO published as the leaf
// subpath `kolu-mcp/fleetRef` for a consumer that must not take this barrel's
// MCP-SDK chain (`@kolu/acp-harness`); it is re-exported here so a consumer
// that already has the barrel does not need a second import path.
export {
  type FleetHost,
  FleetHostSchema,
  type FleetHostState,
  type FleetSurfaceSpec,
  type FleetUrgency,
  fleetSurface,
} from "./fleet/fleetSurface.ts";
export type { FleetHosts } from "./fleet/hosts.ts";
export {
  type FleetTerminalRef,
  fleetTerminalRef,
  splitFleetTerminalRef,
} from "./fleet/ref.ts";
export {
  type ServeKoluFleetMcpOptions,
  serveKoluFleetMcp,
} from "./fleet/serve.ts";
export type { FleetWatchEvent } from "./fleet/watch.ts";
export {
  type KoluMcpConnection,
  type ServeKoluMcpOptions,
  serveKoluMcp,
} from "./serve.ts";
// The tool table's home: `tools.ts`, NOT serve.ts — it is also `kolu
// surface`'s verb table, and must stay loadable without the MCP SDK (see that
// module's header). The same name reaches the `kolu-mcp/tools` subpath
// without this barrel's SDK chain, as those tools mount it.
export { KOLU_MCP_TOOLS } from "./tools.ts";
