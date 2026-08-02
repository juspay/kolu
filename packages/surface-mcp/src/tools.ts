/**
 * Tool dispatch — the two registration paths the adapter takes.
 *
 *   - An **exposed procedure** (`expose: { "node.rerun": { tool: ... } }`):
 *     dispatch calls `client.surface[ns][verb](args)` and wraps the result.
 *   - A **bespoke tool** (`tools: { run: { input, handler } }`): a
 *     hand-authored MCP tool whose handler composes over the live client.
 *     Genuinely call-shaped capabilities (spawn-and-await, path-guarded
 *     reads) ride here, sharing the package's Schema→JSON-Schema + result
 *     framing spine — they just supply an Effect Schema input and a function.
 *
 * Both wrap their return as a `ToolResult` (`content:[{type:"text",...}]`)
 * and surface a thrown error as `isError`.
 *
 * **On cancellation (D10).** Effect RPC carries no `signal`, so a surface
 * member call is cancelled by interrupting the fiber running it — which is what
 * `resources/read` does with the MCP request's `extra.signal`. A BESPOKE
 * handler is a consumer-supplied Promise-shaped function, not a surface member,
 * so it keeps its `AbortSignal` parameter: that is the consumer's own
 * cancellation vocabulary, and the MCP request signal is handed to it verbatim.
 */

import type { Schema } from "effect";

/** A bespoke tool's input schema: any context-free Effect Schema whose DECODED
 *  type is the handler's `args`. The same bound `@kolu/surface`'s `WireSchema<T>`
 *  puts on every spec schema — `RD`/`RE` pinned to `never`, because decoding an
 *  MCP tool argument has no Effect environment to draw services from. */
export type ToolInputSchema<I> = Schema.Codec<I, unknown, never, never>;

/** A hand-authored MCP tool. `input` (optional) validates and shapes the
 *  args; `handler` runs against the live surface `client`, with the call's
 *  `AbortSignal` for cancellation; `description` is the tool's `tools/list` blurb.
 *
 *  `mutates` flags the tool for host authz (`readOnlyHint`/`destructiveHint`).
 *  It is OPTIONAL but defaults CONSERVATIVELY: an absent `mutates` is treated as
 *  MUTATING (`destructiveHint: true`), because `readOnlyHint: true` can let an MCP
 *  host auto-execute a tool unconfirmed — so an unannotated tool must fail SAFE
 *  (assume it writes), never silently advertise as a harmless read. Declare
 *  `mutates: false` ONLY for a genuinely read-only tool (a conscious, reviewable
 *  opt-in into the auto-approvable hint). */
export interface BespokeTool<I = unknown, O = unknown> {
  input?: ToolInputSchema<I>;
  mutates?: boolean;
  description?: string;
  handler: (
    args: I,
    // The surface client is consumer-typed; the adapter holds it opaquely.
    // biome-ignore lint/suspicious/noExplicitAny: client shape is the consumer's, opaque here.
    client: any,
    signal: AbortSignal | undefined,
  ) => Promise<O> | O;
}

/** The MCP `CallTool` result shape we emit. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Wrap a value as a successful tool result (pretty-printed JSON). `undefined`
 *  (a void procedure) becomes an explicit `null` so the text is never empty. */
export function ok(data: unknown): ToolResult {
  const payload = data === undefined ? null : data;
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap an error message as a failed tool result. */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
