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
 * Both wrap their return as a `ToolResult` — the model's prose in `content`,
 * the caller's data in `structuredContent` — and surface a thrown error as
 * `isError`. A failure that has machine-readable detail to carry says so by
 * being a {@link ToolFailure}; anything else reaches the host as its message.
 *
 * **On cancellation (D10).** Effect RPC carries no `signal`, so a surface member
 * call is cancelled by interrupting the fiber running it — and EVERY request this
 * package serves now runs under the MCP request's own `extra.signal` (see
 * `server.ts`'s `runRequest`). A bespoke handler returns an `Effect` like
 * everything else, so it inherits that interruption for free: a cancelled
 * `tools/call` tears down whatever the handler opened, through its own
 * finalizers, with nothing to thread.
 *
 * The `signal` parameter SURVIVES that, and only for one reason: a handler that
 * calls into a scaffold whose cancellation vocabulary is still `AbortSignal`
 * needs one to hand over, and cannot conjure it from its own interruption
 * without building an `AbortController` bridge per call. `kolu-mcp`'s `wait_*`
 * tools are the live example — they drive padi's `runWait`, which takes a
 * signal. A handler that only composes surface members should ignore the
 * parameter and let interruption do the work.
 */

import type { Effect, Schema } from "effect";
import { WRAPPED_VALUE_KEY } from "./jsonschema";

/** A bespoke tool's input schema: any context-free Effect Schema whose DECODED
 *  type is the handler's `args`. The same bound `@kolu/surface`'s `WireSchema<T>`
 *  puts on every spec schema — `RD`/`RE` pinned to `never`, because decoding an
 *  MCP tool argument has no Effect environment to draw services from. */
export type ToolInputSchema<I> = Schema.Codec<I, unknown, never, never>;

/** A hand-authored MCP tool. `input` (optional) validates and shapes the
 *  args; `handler` DESCRIBES the work against the live surface `client` and the
 *  adapter runs it at the one request edge; `description` is the tool's
 *  `tools/list` blurb and `title` its display name — MCP's two distinct
 *  metadata fields, the first written for the model choosing the tool, the
 *  second for the human reading a host's tool list. `title` is optional and a
 *  host that has none falls back to `name`, which is the machine spelling
 *  (`lifecycle_sendInput`) rather than a phrase.
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
  title?: string;
  handler: (
    args: I,
    // The surface client is consumer-typed; the adapter holds it opaquely.
    // biome-ignore lint/suspicious/noExplicitAny: client shape is the consumer's, opaque here.
    client: any,
    /** The MCP request's own signal, for a handler that must hand one to a
     *  scaffold speaking `AbortSignal`. Ignore it otherwise — see the module
     *  doc: the handler's effect is already run under this signal. */
    signal: AbortSignal | undefined,
  ) => Effect.Effect<O, unknown>;
}

/** The MCP `CallTool` result shape we emit — the SAME answer twice, on purpose.
 *  `content` is prose for the model to read; `structuredContent` is data for the
 *  caller to act on, so neither side has to parse the other's. MCP types the
 *  structured arm as a JSON **object**, which is the whole reason for
 *  {@link asStructured}'s wrapping. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** MCP types `structuredContent` as a JSON OBJECT, so a scalar, array or `null`
 *  payload cannot travel as itself. It is wrapped under the SAME single `value`
 *  property `enforceObject` wraps a scalar INPUT under — one wrapping rule in
 *  both directions, so a host that learned `{ value: … }` on the way in reads
 *  the same shape on the way out.
 *
 *  Always populated on a success, deliberately: "does this tool have a
 *  structured arm?" is not a question an agent should have to branch on, and the
 *  adapter has the object in hand at the moment it stringifies it. */
function asStructured(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : { [WRAPPED_VALUE_KEY]: payload };
}

/** Wrap a value as a successful tool result: pretty-printed JSON for the model,
 *  the same value as `structuredContent` for the caller. `undefined` (a void
 *  procedure) becomes an explicit `null` so the text is never empty. */
export function ok(data: unknown): ToolResult {
  const payload = data === undefined ? null : data;
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: asStructured(payload),
  };
}

/** Wrap an error message as a failed tool result, with `detail` as the
 *  structured arm when the refusal has one (see {@link ToolFailure}). Omitted
 *  rather than `undefined` when there is none: an absent key and a present-but-
 *  empty one read differently to a host. */
export function fail(
  message: string,
  detail?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(detail === undefined ? {} : { structuredContent: detail }),
    isError: true,
  };
}

/** A refusal WITH data attached — what a bespoke handler fails (or throws) with
 *  when the answer is "no" and the reason is machine-readable.
 *
 *  A refusal is an answer, not a protocol fault, so it comes back as an
 *  `isError` tool result; what this type adds is that the answer arrives as
 *  DATA. "These three children are not done" is a list the agent can act on,
 *  not a sentence it has to parse back apart — and `message` stays the prose
 *  the model reads, because the two are different jobs and only the raiser
 *  knows both.
 *
 *  It is a NAMED type rather than a rule over whatever an error happens to
 *  carry, and that is the design: structuring any object-shaped failure would
 *  publish a `Data.TaggedError`'s `stack` into the agent's data channel and
 *  dress an incidental `TypeError` up as a contract. Every other failure keeps
 *  the message-only framing — see `server.ts`'s `failFrom`. */
export class ToolFailure extends Error {
  readonly detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown>) {
    super(message);
    this.name = "ToolFailure";
    this.detail = detail;
  }
}
