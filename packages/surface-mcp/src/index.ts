/**
 * @kolu/surface-mcp — re-expose any `@kolu/surface` as an MCP server.
 *
 * A generic adapter generalizing odu's hand-built `src/mcp/` face. The public
 * surface is small and default-deny: declare what an agent may touch via
 * `expose` (+ optional bespoke `tools`), hand it a live-surface `client`
 * factory, and `serveSurfaceAsMcp` builds the low-level MCP `Server` — the
 * subscribe/teardown lifecycle, the Effect Schema→JSON-Schema bridge, and the
 * resource/tool wiring are the package's.
 */

export {
  type ExposeMap,
  type ResolvedExpose,
  type ResourceEntry,
  type ResourceTemplateEntry,
  resolveExpose,
  type ToolEntry,
  type ToolExposure,
} from "./expose";
export { toInputSchema } from "./jsonschema";
// `OwnedSurfaceConnection` IS this type at the adapter's client shape, and the
// public doc links to it — so a consumer reading that doc has to be able to
// import the name it names.
export type { PusherConnection } from "./pusher";
export {
  type ClientOrConnection,
  type OwnedSurfaceConnection,
  type ServeSurfaceAsMcpOptions,
  serveSurfaceAsMcp,
  type SurfaceClientCallable,
} from "./server";
export {
  type BespokeTool,
  ToolFailure,
  type ToolInputSchema,
  type ToolResult,
} from "./tools";
