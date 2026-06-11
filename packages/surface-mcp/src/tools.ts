/**
 * Tool dispatch — the two registration paths the adapter takes.
 *
 *   - An **exposed procedure** (`expose: { "node.rerun": { tool: ... } }`):
 *     dispatch calls `client.surface[ns][verb](args, { signal })` and wraps
 *     the result.
 *   - A **bespoke tool** (`tools: { run: { input, handler } }`): a
 *     hand-authored MCP tool whose handler composes over the live client.
 *     Genuinely call-shaped capabilities (spawn-and-await, path-guarded
 *     reads) ride here, sharing the package's zod→JSON-Schema + result
 *     framing + signal threading spine — they just supply a zod input and a
 *     function.
 *
 * Both wrap their return as a `ToolResult` (`content:[{type:"text",...}]`)
 * and surface a thrown error as `isError`. The `CallTool` `extra.signal` is
 * threaded through so cancelling the MCP request promptly tears the call's
 * downstream work (an open stream, a blocking wait).
 */

import type { ZodType } from "zod";

/** A hand-authored MCP tool. `input` (optional) validates and shapes the
 *  args; `handler` runs against the live surface `client`, with the call's
 *  `AbortSignal` for cancellation. `mutates` flags it for host authz;
 *  `description` is the tool's `tools/list` blurb. */
export interface BespokeTool<I = unknown, O = unknown> {
  input?: ZodType<I>;
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
