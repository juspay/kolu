/**
 * Tool dispatch — the two registration paths the adapter takes.
 *
 *   - An **exposed procedure** (`expose: { "node.rerun": { tool: ... } }`):
 *     dispatch calls `client.surface[ns][verb](args)` and wraps the result.
 *   - A **bespoke tool** (`tools: { run: { input, handler } }`): a
 *     hand-authored, call-shaped verb whose handler composes over the live
 *     client. Genuinely call-shaped capabilities (spawn-and-await, path-guarded
 *     reads) ride here, sharing the framework's Schema→JSON-Schema bridge and
 *     this package's result framing — they just supply an Effect Schema input
 *     and a function. The record itself is the framework's `SurfaceVerb`
 *     (`@kolu/surface/verbs`), re-exported from this package's root as
 *     `BespokeTool`: an app hands the SAME record to the CLI face.
 *
 * Both wrap their return as a `ToolResult` — the model's prose in `content`,
 * the caller's data in `structuredContent` — and surface a thrown error as
 * `isError`. A failure that has machine-readable detail to carry says so by
 * being a {@link ToolFailure}; anything else reaches the host as its message.
 *
 * The RESULT-FRAMING SPINE is all of it, not just the happy path: {@link ok},
 * {@link fail}, {@link failFrom} and {@link brand} live here together, so the
 * coercion from an arbitrary thrown value to a framed answer sits beside the
 * shape it is coerced into. Both request edges (`tools/call` and
 * `resources/read`) call in; neither owns a second copy. The SENTENCE inside
 * that coercion is the framework's `messageOf` (`@kolu/surface/verbs`), because
 * the CLI face folds failures into answers too — re-exported here.
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

import { messageOf, wrapValue } from "@kolu/surface/verbs";

// "What did this failure SAY" is the FRAMEWORK's derivation
// (`@kolu/surface/verbs`): both projecting faces fold a caught failure into an
// answer, and a second copy is a place they can disagree about the sentence.
// Re-exported from this package's root under the name it shipped with, and used
// by {@link failFrom} below exactly as when it lived here.
export { messageOf };

/** The MCP `CallTool` result shape we emit. `content` is prose for the model to
 *  read; `structuredContent` is data for the caller to act on, so neither side
 *  has to parse the other's.
 *
 *  On a SUCCESS they are the same answer twice, read off ONE serialization so
 *  they cannot disagree. On a REFUSAL they are deliberately different: the
 *  sentence and the machine-readable reason are two jobs, and only the raiser
 *  knows both (see {@link ToolFailure}).
 *
 *  MCP types the structured arm as a JSON **object**, which is the whole reason
 *  for `wrapping.ts`'s `wrapValue`. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** The WIRE FORM of a value — the one transform BOTH arms read their structure
 *  off, so a refusal's detail cannot be a shape the success arm would have
 *  rejected, and neither arm can publish a `structuredContent` that serializes
 *  as something other than what was measured.
 *
 *  `JSON.stringify` is the transform the wire applies anyway; running it here
 *  and reading the result back is reading what the caller will actually receive.
 *  `undefined` comes back only for a value JSON has no form for at all (a bare
 *  function or symbol) — not a wire value, so it travels as the same explicit
 *  `null` a void procedure gets, on BOTH arms. */
function wireForm(data: unknown): { text: string; json: unknown } {
  const text = JSON.stringify(data, null, 2) ?? "null";
  return { text, json: JSON.parse(text) };
}

/** The structured arm of a FAILURE's detail: the value as the wire will carry
 *  it, wrapped if JSON renders it as a non-object.
 *
 *  Only the failure arm has this helper, and deliberately: `ok` needs BOTH
 *  halves of {@link wireForm} and destructures them from one call, while a
 *  refusal's prose is the raiser's own message and only the structured half is
 *  derived. Composing this into `ok` too would read tidier and serialize every
 *  answer twice — measurably ~2ms and a second full copy on the megabyte
 *  scrollback `screen_text` can return. */
function structuredArm(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  return wrapValue(wireForm(detail).json);
}

/** Wrap a value as a successful tool result: pretty-printed JSON for the model,
 *  the same value as `structuredContent` for the caller. `undefined` (a void
 *  procedure) becomes an explicit `null` so the text is never empty.
 *
 *  ONE serialization feeds both arms, and the re-parse that costs is the point:
 *  it is what makes "the same answer twice" true by construction rather than by
 *  two code paths agreeing.
 *
 *  `structuredContent` is always populated on a success, deliberately: "does
 *  this tool have a structured arm?" is not a question an agent should have to
 *  branch on, and the adapter has the value in hand at the moment it
 *  stringifies it. */
export function ok(data: unknown): ToolResult {
  const { text, json } = wireForm(data);
  return {
    content: [{ type: "text", text }],
    structuredContent: wrapValue(json),
  };
}

/** Wrap an error message as a failed tool result, with `detail` as the
 *  structured arm when the refusal has one (see {@link ToolFailure}). Omitted
 *  rather than `undefined` when there is none: an absent key and a present-but-
 *  empty one read differently to a host.
 *
 *  The detail goes through the SAME {@link wireForm} + `wrapValue` the success
 *  arm does. Passing it through untouched published whatever the raiser built:
 *  a detail whose JSON form is not an object reached the wire as a non-object
 *  `structuredContent` (MCP types it as an object), and a detail JSON cannot
 *  render at all — a cycle — threw inside the TRANSPORT's serializer, where the
 *  request is already past every catch and simply never gets answered. Both are
 *  measured in `server.test.ts`. Normalizing here moves the throw in front of
 *  the SDK's request-handler boundary, which answers it as an error instead. */
export function fail(
  message: string,
  detail?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(detail === undefined
      ? {}
      : { structuredContent: structuredArm(detail) }),
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
 *  the message-only framing — see {@link failFrom}.
 *
 *  `D` is the raiser's own refusal vocabulary, carried so a consumer's tagged
 *  union survives to the place it is asserted on instead of widening to
 *  `Record<string, unknown>` the moment it is constructed.
 *
 *  TWO LIMITS worth knowing, both deliberate:
 *
 *    - The discriminant is `instanceof`, which is nominal: it holds only for a
 *      value built from THIS module instance. That is sound because the package
 *      is `private` and every consumer resolves it as a `workspace:*` link to
 *      the same source entrypoint — there is no publish, no bundle and no
 *      version skew that could mint a second class object.
 *    - A failure raised on the FAR SIDE of a surface hop (a procedure error
 *      decoded off the wire by `@kolu/surface-remote`) is not a `ToolFailure`
 *      and reaches the agent message-only. A handler that wants such a refusal
 *      structured catches it and re-raises it as one — the MCP server process
 *      is where a refusal is tagged. */
export class ToolFailure<
  D extends Record<string, unknown> = Record<string, unknown>,
> extends Error {
  readonly detail: D;
  constructor(message: string, detail: D) {
    super(message);
    this.name = "ToolFailure";
    this.detail = detail;
  }
}

/** This adapter's own name — what {@link brand} prefixes with, and the `face` an
 *  `ExposeMapError` carries when the shared grammar refuses a map handed to
 *  `serveSurfaceAsMcp`. ONE spelling, so a branded message and a branded error
 *  can never disagree about which door the consumer came through. */
export const ADAPTER_NAME = "surface-mcp";

/** Put this adapter's name on a message a host will read.
 *
 *  ONE rule, one mechanism: an error raised INSIDE the adapter carries the bare
 *  fact, and the REQUEST EDGE that answers the host brands it — {@link failFrom}
 *  for `tools/call`, the `resources/read` handler for reads. An edge that
 *  composes its own message (an unknown tool, an unknown URI), and a boot-time
 *  throw that never crosses an edge at all, call this directly. Nothing is
 *  prefixed twice, because nothing is prefixed before the edge — which the
 *  born-dead error used to be, reaching agents as `surface-mcp: surface-mcp: …`. */
export const brand = (message: string): string => `${ADAPTER_NAME}: ${message}`;

/** Coerce an unknown thrown value into a failed `ToolResult` — the `tools/call`
 *  edge's branding (see {@link brand}).
 *
 *  A {@link ToolFailure} is the ONE failure that carries data through: the
 *  raiser said, by choosing that type, both what the model should read and what
 *  the caller should act on. Nothing else is structured, and that is deliberate
 *  — see `ToolFailure`'s own doc for why guessing from an error's own properties
 *  is worse than saying nothing.
 *
 *  Effect's `runPromise` rejects with the DECLARED failure value itself (not a
 *  wrapper), so a handler's domain error arrives here intact — which is what
 *  makes both this discrimination and {@link messageOf} possible at all. */
export function failFrom(e: unknown): ToolResult {
  // `messageOf` on BOTH arms, so the detail decides only whether there IS a
  // structured arm — never how the prose is derived. A `ToolFailure` carries its
  // own message and takes the first branch of `messageOf` unchanged; routing it
  // through anyway is what stops one built with an empty message from reaching
  // the host as the bare brand, which is the very regression below.
  const message = brand(messageOf(e));
  return e instanceof ToolFailure ? fail(message, e.detail) : fail(message);
}
