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

// `ExposeMap` / `ToolExposure` are deliberately NOT re-exported here: the map
// shape is the framework's shared vocabulary and has ONE home,
// `@kolu/surface/expose`, which every face imports it from.
export {
  type ResolvedExpose,
  type ResourceEntry,
  type ResourceTemplateEntry,
  resolveExpose,
  type ToolEntry,
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
  // The adapter's own "name what broke" derivation. Exported because a bespoke
  // tool that folds a failure INTO its answer (rather than raising it) has to
  // reach the same one the request edge would have used — a hand-rolled
  // `e instanceof Error ? e.message : String(e)` is the spelling this function's
  // own doc records as wrong for two shapes Effect actually delivers.
  messageOf,
  // The image-content constructor a bespoke tool reaches for from its
  // `render` hook — the one in-tree face whose answer is pixels rather than
  // prose (kolu's `screen_image`).
  okImage,
  ToolFailure,
  type ToolContent,
  type ToolInputSchema,
  type ToolResult,
} from "./tools";
