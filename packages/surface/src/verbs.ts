/**
 * The PROJECTION VOCABULARY — what a hand-authored verb is, what it is called,
 * and what its input looks like to a caller that speaks no Effect Schema.
 *
 * A surface is served to more than one kind of caller. `@kolu/surface-mcp`
 * projects it as MCP tools and resources; `@kolu/surface-cli` projects it as
 * argv. Both need the SAME things, and none of them is about either transport:
 *
 *   - {@link SurfaceVerb} — a hand-authored, call-shaped capability whose
 *     handler composes over a live surface client. It was called `BespokeTool`
 *     and lived in the MCP adapter; the name was the only MCP-specific thing
 *     about it, and an app hands the SAME record to both faces.
 *   - {@link toolName} — the flat name a procedure `<ns>.<verb>` answers to on
 *     a face that has no dots to spend. ONE derivation, so the MCP tool
 *     `git_commit` and the CLI verb `git commit`… is not a thing: they are one
 *     name, `git_commit`, and two faces cannot drift.
 *   - {@link toInputSchema} — the Effect Schema → JSON-Schema bridge, with the
 *     wrapping rule that rides with it. A face that has to DESCRIBE an input to
 *     a schema-less caller (an MCP host's `tools/list`, a CLI's flag table)
 *     reads the same normalized document. It is the one VOLATILE piece here (an
 *     effect-version seam with a byte fixture over it), so it lives in
 *     `./jsonSchemaBridge` and is re-exported below — one import path, and a
 *     file that says which half moves.
 *   - {@link decodeTextValue} — land a text token in a declared type. Every
 *     schema-less caller hands scalars over as text, and the two faces address
 *     the same items by it, so it is one rule or it is a way for them to
 *     disagree.
 *   - {@link admitsNoArgument} — does a member's declared input admit "no
 *     argument at all"? The question every face asks before offering a member
 *     that carries none.
 *
 * They live HERE, in the framework, for the reason `@kolu/surface/expose` gives
 * for the expose map: two faces reading one contract by two grammars is the
 * drift a shared home exists to prevent. The adapters keep what only they know
 * — a `surface://` URI, an argv grammar, a result framing.
 *
 * Two things that ARRIVED here and are not projection vocabulary have moved on
 * to their generative homes, so nothing has to import this module to reach
 * them: `SurfaceClientCallable` is `@kolu/surface/client`'s (it is a loosening
 * of `SurfaceFace`, beside the builder that mints the value it describes), and
 * `messageOf` is `@kolu/surface/errors`'s ("what did this failure say" is
 * failure vocabulary, and it words a stdin read and a run-edge defect that have
 * nothing to do with verbs). There is deliberately no re-export of either: one
 * concept, one import path.
 *
 * `@kolu/surface-mcp` re-exports {@link SurfaceVerb} as `BespokeTool` and
 * {@link SurfaceVerbInputSchema} as `ToolInputSchema`, so a consumer written
 * against the adapter keeps compiling.
 */

import type { Effect } from "effect";
import { Option, Schema } from "effect";
import type { WireSchemaAny } from "./define";

// ── The bridge, re-exported ──────────────────────────────────────────────
//
// One import path for the whole vocabulary; the file split behind it is about
// which half is volatile, not about where a consumer types the name.
export {
  type AdvertisedInput,
  inputSchema,
  toInputSchema,
  unwrapArgs,
  wrapValue,
} from "./jsonSchemaBridge";

// ── The verb record ──────────────────────────────────────────────────────

/** A hand-authored verb's input schema: any context-free Effect Schema whose
 *  DECODED type is the handler's `args`. The same bound `@kolu/surface`'s
 *  `WireSchema<T>` puts on every spec schema — `RD`/`RE` pinned to `never`,
 *  because decoding an argument that arrived as argv or as JSON has no Effect
 *  environment to draw services from. */
export type SurfaceVerbInputSchema<I> = Schema.Codec<I, unknown, never, never>;

/** A hand-authored, call-shaped capability over a served surface — the record
 *  an app hands to EVERY projecting face verbatim.
 *
 *  `input` (optional) validates and shapes the args; `handler` DESCRIBES the
 *  work against the live surface `client` and the face runs it at its one
 *  request edge; `description` is the verb's listing blurb and `title` its
 *  display name — two distinct metadata fields, the first written for the
 *  model or the reader choosing the verb, the second for a human reading a
 *  list. `title` is optional and a face that has none falls back to the machine
 *  spelling (`lifecycle_sendInput`) rather than a phrase.
 *
 *  `mutates` flags the verb for host authz (MCP's `readOnlyHint` /
 *  `destructiveHint`). It is OPTIONAL but defaults CONSERVATIVELY: an absent
 *  `mutates` is treated as MUTATING, because `readOnlyHint: true` can let an
 *  MCP host auto-execute a verb unconfirmed — so an unannotated verb must fail
 *  SAFE (assume it writes), never silently advertise as a harmless read.
 *  Declare `mutates: false` ONLY for a genuinely read-only verb (a conscious,
 *  reviewable opt-in into the auto-approvable hint).
 *
 *  The `signal` parameter is for a handler that must hand an `AbortSignal` to a
 *  scaffold whose cancellation vocabulary is still one. Under Effect,
 *  cancellation IS fiber interruption: a handler that only composes surface
 *  members should ignore the parameter and let interruption do the work. A face
 *  with no signal to give passes `undefined`. */
export interface SurfaceVerb<I = unknown, O = unknown> {
  input?: SurfaceVerbInputSchema<I>;
  mutates?: boolean;
  description?: string;
  title?: string;
  handler: (
    args: I,
    // The surface client is consumer-typed; a face holds it opaquely.
    // biome-ignore lint/suspicious/noExplicitAny: client shape is the consumer's, opaque here.
    client: any,
    /** The face's own request signal, for a handler that must hand one to a
     *  scaffold speaking `AbortSignal`. Ignore it otherwise. */
    signal: AbortSignal | undefined,
  ) => Effect.Effect<O, unknown>;
}

// ── The flat name ────────────────────────────────────────────────────────

/** The flat name a procedure answers to on a face with no dots to spend —
 *  `<ns>_<verb>` (`.` is illegal in an MCP tool name, and a nested CLI spelling
 *  would be a second name for one function).
 *
 *  Only the SEPARATOR becomes `_`. A namespace that itself contains a dot keeps
 *  it: `procedures: { "a.b": { c } }` mints `a.b_c`, not `a_b_c` — the name has
 *  to be reversible to one `(ns, verb)` pair, and rewriting every dot would make
 *  `a.b`·`c` and `a`·`b.c` the same verb. */
export function toolName(ns: string, verb: string): string {
  return `${ns}_${verb}`;
}

// ── Text in, declared type out ───────────────────────────────────────────

/** A text token, landed in a declared schema — in BOTH readings.
 *
 *  `decoded` is the value the schema produced; `encoded` is the reading that
 *  produced it — the token verbatim, or its `JSON.parse` form. Both, because
 *  the two faces need different ones and neither can re-derive the other: an
 *  MCP resource read addresses a collection item with the DECODED key, while a
 *  CLI hands a member's `get` the ENCODED input, because the client's own
 *  member ref decodes what it is given. A face that forwarded the raw token to
 *  a member whose input is a number handed a string to a decoder that had
 *  already proven it needed a number — which fails as a DEFECT at the call
 *  site, outside every error contract the face publishes. */
export interface TextValue {
  readonly encoded: unknown;
  readonly decoded: unknown;
}

/** Land a TEXT token in a declared schema's type — the rule every schema-less
 *  caller needs, because every schema-less caller hands scalars over as text.
 *
 *  Tries the token VERBATIM first: that covers `Schema.String`,
 *  `Schema.Literal("foo")`, `Schema.Literals(["a","b"])` and any other
 *  string-accepting schema. If the verbatim decode fails, falls back to
 *  `JSON.parse` and re-decodes, which covers numeric (`Schema.Finite`,
 *  `Schema.Int`) and boolean values whose text form is their JSON form (`"42"`
 *  → `42`). A token that fails both paths is `Option.none`.
 *
 *  ONE rule, shared, because the two faces address the SAME items by it: the
 *  `<id>` segment of `surface://collections/processes/42` and the argv token in
 *  `surface get processes 42` must decode to the same key, or the two faces
 *  address different items with the same spelling. What each face DOES with a
 *  `none` differs — MCP treats it as an unaddressable URI, the CLI raises a
 *  usage error naming the argument — so the answer is an `Option` and the
 *  policy stays at the face. */
export function decodeTextValue(
  schema: WireSchemaAny,
  text: string,
): Option.Option<TextValue> {
  const decode = Schema.decodeUnknownOption(schema);
  const direct = decode(text);
  if (Option.isSome(direct))
    return Option.some({ encoded: text, decoded: direct.value });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Option.none(); // not JSON — undecodable for a non-string schema
  }
  return Option.map(decode(parsed), (decoded) => ({
    encoded: parsed,
    decoded,
  }));
}

/** Does this member's declared input admit "no argument at all"?
 *
 *  The question every projecting face has to ask before offering a member that
 *  carries no input: MCP before publishing a `surface://<kind>s/<key>` static
 *  resource (that URI carries no input, so the adapter reads via
 *  `.get(undefined)`), the CLI before letting `get <member>` stand with no
 *  `[arg]`. `Schema.Void` — what a no-input member declares — admits
 *  `undefined`; a struct does not.
 *
 *  ONE predicate, because two hand-written spellings held in agreement by a
 *  comment is how the two faces come to disagree about which members are
 *  addressable at all: one would refuse at boot while the other accepted and
 *  hung. What each face DOES with a `false` stays the face's own policy — a
 *  boot refusal there, a usage error here — exactly as {@link decodeTextValue}'s
 *  `Option` already leaves it. */
export function admitsNoArgument(schema: WireSchemaAny): boolean {
  return Option.isSome(Schema.decodeUnknownOption(schema)(undefined));
}
