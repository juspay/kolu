/**
 * @kolu/surface-mcp — re-expose any `@kolu/surface` as an MCP server.
 *
 * A generic adapter generalizing odu's hand-built `src/mcp/` face. The public
 * surface is small and default-deny: declare what an agent may touch via
 * `expose` (+ optional bespoke `tools`), hand it a live-surface `client`
 * factory, and `serveSurfaceAsMcp` builds the low-level MCP `Server` — the
 * subscribe/teardown lifecycle, the zod→JSON-Schema bridge, and the
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
export {
  type ServeSurfaceAsMcpOptions,
  type SurfaceClientOf,
  serveSurfaceAsMcp,
} from "./server";
export type { BespokeTool, ToolResult } from "./tools";
