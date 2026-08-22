/**
 * The PROJECTION VOCABULARY — what a hand-authored verb is, what it is called,
 * and what its input looks like to a caller that speaks no Effect Schema.
 *
 * A surface is served to more than one kind of caller. `@kolu/surface-mcp`
 * projects it as MCP tools and resources; `@kolu/surface-cli` projects it as
 * argv. Both need the SAME three things, and none of the three is about either
 * transport:
 *
 *   - {@link SurfaceVerb} — a hand-authored, call-shaped capability whose
 *     handler composes over a live surface client. It was called `BespokeTool`
 *     and lived in the MCP adapter; the name was the only MCP-specific thing
 *     about it, and an app hands the SAME record to both faces.
 *   - {@link toolName} — the flat name a procedure `<ns>.<verb>` answers to on
 *     a face that has no dots to spend. ONE derivation, so the MCP tool
 *     `git_commit` and the CLI verb `git commit`… is not a thing: they are one
 *     name, `git_commit`, and two faces cannot drift.
 *   - {@link toInputSchema} — the Effect Schema → JSON-Schema bridge. A face
 *     that has to DESCRIBE an input to a schema-less caller (an MCP host's
 *     `tools/list`, a CLI's flag table) reads the same normalized document.
 *
 * They live HERE, in the framework, for the reason `@kolu/surface/expose` gives
 * for the expose map: two faces reading one contract by two grammars is the
 * drift a shared home exists to prevent. The adapters keep what only they know
 * — a `surface://` URI, an argv grammar, a result framing.
 *
 * `@kolu/surface-mcp` re-exports {@link SurfaceVerb} as `BespokeTool` and
 * {@link SurfaceVerbInputSchema} as `ToolInputSchema`, so a consumer written
 * against the adapter keeps compiling.
 *
 * ## The bridge, and the five divergences it pins
 *
 * Surface descriptors carry Effect Schemas; a schema-less caller wants JSON
 * Schema. Effect ships the converter natively (`Schema.toJsonSchemaDocument`,
 * draft 2020-12 — the dialect MCP standardized on), so the engine is *bought*.
 * What this module *owns* is the adapter glue around it, and that glue is
 * bigger than a taste preference: the MCP `tools/list` JSON Schema is on the
 * repo's byte-compatibility hit list (it is read by Anthropic, Gemini, Bedrock,
 * Codex and Claude Desktop), and Effect's converter diverges from the zod
 * converter this code was built on in five MEASURED ways. Each divergence and
 * its fix is named below; `verbs.test.ts` is the gate that keeps them fixed.
 *
 *   1. **Every object is CLOSED.** Effect emits `additionalProperties: false`
 *      on every object; zod emitted nothing. A closed tool input is an outright
 *      host break (a host that sends one extra key gets a validation failure),
 *      so the converter is asked for `additionalProperties: true` and the walk
 *      then DROPS the redundant `true` — absent already means open in JSON
 *      Schema, and dropping it restores the zod-era bytes exactly.
 *   2. **`Schema.Number` is Infinity/NaN-tolerant.** Its encoded form is
 *      `anyOf: [{type:"number"}, {type:"string", enum:["Infinity","-Infinity","NaN"]}]`
 *      — faithful to the codec, useless to a host, which will happily offer the
 *      agent the string `"NaN"` as a legal argument. The faithful spellings for
 *      an outward-facing numeric are `Schema.Finite` (`{type:"number"}`)
 *      and `Schema.Int` (`{type:"integer"}`); the walk additionally NORMALIZES
 *      the tolerant union back to its numeric arm, so a spec author who wrote
 *      plain `Schema.Number` cannot ship the union by accident. Normalizing is
 *      safe in one direction only, and this is that direction: it narrows what
 *      a caller will *offer*, while the actual decode still runs against the
 *      real schema.
 *   3. **`Schema.Void` / `Schema.Undefined` encode as `{"type":"null"}`.** Fed
 *      through `enforceObject` that turns a NO-ARG verb into one demanding
 *      `{"value": null}`. They are special-cased to {@link emptyObjectSchema}
 *      BEFORE `enforceObject` ever sees them.
 *   4. **A DECODING default does not reach the document.** zod's
 *      `.default(v)` emitted `default: v`; Effect's `withDecodingDefaultKey` is
 *      a transformation, and the encoded document cannot see through it. What
 *      Effect *does* emit is the standard `default` ANNOTATION — but only when
 *      it sits on the ENCODED-side node, i.e. INSIDE `optionalKey`, before the
 *      decoding transformation. So the law for a defaulted outward-facing field
 *      is
 *      `Schema.optionalKey(X.annotate({ default: v })).pipe(Schema.withDecodingDefaultKey(...))`,
 *      and the annotation placement is pinned by the tests (both the spelling
 *      that round-trips and the one that silently loses the keyword).
 *   5. **`$defs` live off the schema.** Effect returns a `Document`
 *      (`{dialect, schema, definitions}`): `$ref`s point at `#/$defs/<name>`
 *      while the pool is `Document.definitions`, NOT a `$defs` key on the root
 *      schema. {@link collectDefs} reads the document, not the schema object.
 *
 * On top of those, the two rules the bridge has always owned survive unchanged:
 *
 *   - a **dereference pass** that inlines every local `$ref` and strips the
 *     pool. `$ref` is rejected across a wide client matrix (Anthropic, Gemini,
 *     Bedrock, Codex, Claude Desktop) even though it is valid 2020-12 — the MCP
 *     TS SDK hit exactly this. Effect refs both REUSED and RECURSIVE schemas
 *     (any `identifier` annotation lands in `definitions`), and a recursive one
 *     cannot be inlined finitely, so the property carrying it is dropped rather
 *     than crashing the verb.
 *   - a top-level `{ type: "object" }` enforcement, wrapping a non-object input
 *     so every verb's advertised input is the object shape a face can name
 *     field by field.
 *
 * One `toInputSchema()`, byte-pinned, because the converter's option defaults
 * are an effect-version seam exactly as zod's were.
 *
 * ## The wrapping rule — a non-object input travels under one property
 *
 * MCP demands OBJECTS on both edges: a verb's advertised input must describe an
 * object, and `structuredContent` must BE one. So a scalar, an array, a `null`
 * or a union has to travel under a single property, and whatever wraps it must
 * be undone by whatever reads it. The three moves that rule needs are here
 * together — advertise a wrapped input ({@link wrapSchema}), read the argument
 * back out ({@link unwrapArgs}), wrap a non-object result ({@link wrapValue}) —
 * rather than in three modules held in agreement by an exported constant.
 * `WRAP_KEY` is private: nothing outside this file has to know the spelling.
 *
 * The INPUT half is every face's (the CLI advertises a wrapped scalar as one
 * `value` flag, or binds it to a positional); the RESULT half is the MCP face's
 * alone today, and it stays beside its siblings because all three read one key.
 * The two edges are NOT one predicate, and that is worth stating plainly
 * because the shape of it is user-visible — see {@link wrapValue}.
 */

import type { Effect } from "effect";
import { Option, Schema } from "effect";
import type { WireSchemaAny } from "./define";

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

// ── The wrapping rule ────────────────────────────────────────────────────

/** The single property a non-object value travels under. Private on purpose:
 *  the rename hazard is gone when only this file knows the string. */
const WRAP_KEY = "value";

/** A JSON-Schema document or sub-schema. Walked structurally rather than typing
 *  every keyword, so `unknown`-valued records are the working shape. */
type JsonSchema = Record<string, unknown>;

/** "JSON renders this as an OBJECT" — the one predicate both edges of the
 *  wrapping rule are decided by, so {@link wrapValue}'s runtime test and the
 *  document walk cannot drift apart into two hand-written expressions that
 *  merely happen to agree. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Advertise a non-object INPUT as an object with one property. Decided from
 *  the DECLARED schema, so `wrapped` is a static bit a face carries and
 *  {@link unwrapArgs} reads back. */
export function wrapSchema(schema: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: { [WRAP_KEY]: schema },
    required: [WRAP_KEY],
  };
}

/** Undo {@link wrapSchema} before handing args to a verb's schema. `wrapped` is
 *  the bit {@link inputSchema} reported for that input, not a guess about the
 *  value. The one place this rule lives; every dispatch branch calls in. */
export function unwrapArgs(
  wrapped: boolean,
  args: Record<string, unknown>,
): unknown {
  return wrapped ? args[WRAP_KEY] : args;
}

/** Wrap a RESULT that JSON renders as a non-object, so a face whose result
 *  channel is typed as an object always has one.
 *
 *  Decided from the VALUE, not from a schema — the MCP adapter advertises no
 *  `outputSchema`, so there is no declared result shape to read the bit off.
 *  That is the ONE place the two edges differ, and it is observable: they agree
 *  for every scalar, array and `null`, but a union input whose runtime value
 *  happens to be an object is advertised WRAPPED (`{ value: { a: 1 } }` on the
 *  way in) and answers BARE (`{ a: 1 }` on the way out). A caller therefore
 *  cannot recover, from the result alone, whether a `{ value: 42 }` it received
 *  was the verb's own object or a wrapped scalar `42`. Documented rather than
 *  closed: wrapping every result instead would change the shape of every
 *  success the MCP adapter has ever emitted.
 *
 *  Takes a value that has ALREADY been through JSON, which is what makes the
 *  object test sound: `typeof` describes the value in memory and `toJSON`
 *  decides the one on the wire, and those disagree for the everyday case of a
 *  `Date`. Handed a live object this returned a structured arm that serializes
 *  as a string — which an MCP client rejects as a PROTOCOL error, on the
 *  success path, where no error framing can catch it. */
export function wrapValue(json: unknown): Record<string, unknown> {
  return isRecord(json) ? json : { [WRAP_KEY]: json };
}

// ── The Schema → JSON-Schema bridge ──────────────────────────────────────

/** The draft-2020-12 document Effect's converter returns: the root `schema`
 *  plus a SEPARATE `definitions` pool that `#/$defs/<name>` pointers address. */
type JsonSchemaDocument = ReturnType<typeof Schema.toJsonSchemaDocument>;

/** The empty-input schema — a verb that takes no args. A face wants an object
 *  with no properties, not a missing/`true` schema. */
function emptyObjectSchema(): JsonSchema {
  return { type: "object", properties: {} };
}

/** Convert a descriptor's Effect Schema to an advertisable input schema. With
 *  no schema (a no-arg procedure) returns the empty-object schema. Otherwise
 *  runs `Schema.toJsonSchemaDocument` with the pinned options, dereferences
 *  every local `$ref`, and enforces a top-level object. */
export function toInputSchema(schema?: WireSchemaAny): Record<string, unknown> {
  return inputSchema(schema).schema;
}

/** As {@link toInputSchema}, but also reports whether the original schema was a
 *  non-object (scalar/array/union) that had to be wrapped under a single
 *  `value` property. A dispatching face needs `wrapped` so it can
 *  {@link unwrapArgs} back into the bare value the verb's schema actually
 *  expects (a `Schema.String` input is advertised as `{ value: string }`, but
 *  the procedure wants the string itself). */
export function inputSchema(schema?: WireSchemaAny): {
  schema: Record<string, unknown>;
  wrapped: boolean;
} {
  // Divergence 3: a NO-ARG member declares `Schema.Void` (what `defineSurface`
  // substitutes for an absent `input`), whose ENCODED form is `{"type":"null"}`.
  // Caught here, before `enforceObject` can wrap it into a verb that demands
  // `{"value": null}` from every caller.
  if (schema === undefined || isNoArgSchema(schema))
    return { schema: emptyObjectSchema(), wrapped: false };

  const doc = Schema.toJsonSchemaDocument(schema, {
    // Divergence 1: ask for OPEN objects. The walk drops the redundant `true`.
    additionalProperties: true,
  });

  return enforceObject(dereference(doc));
}

/** Does this schema declare "no argument at all"? `Schema.Void` is what
 *  `defineSurface` mints for a member with no declared input, and
 *  `Schema.Undefined` is its hand-written sibling; both encode as
 *  `{"type":"null"}`, which is meaningless as an input. Checked on the AST
 *  rather than on the emitted document so a genuine `Schema.Null` FIELD keeps
 *  its honest `{"type":"null"}`. */
function isNoArgSchema(schema: WireSchemaAny): boolean {
  const tag = schema.ast._tag;
  return tag === "Void" || tag === "Undefined";
}

/** Inline every local `$ref` against the document's own `definitions` pool,
 *  then strip the pool. Returns a fresh tree; the input is not mutated. A
 *  `$ref` that cannot be inlined finitely (a recursive schema, which Effect
 *  always emits as a self-referencing definition) is dropped by the parent
 *  walker — see `walkProperties`. */
function dereference(doc: JsonSchemaDocument): JsonSchema {
  const defs = collectDefs(doc);

  // Guard against a pathological mutually-recursive definition chain inflating
  // without bound: once we've expanded a given pointer on the current path,
  // a re-entry is a cycle we drop (the `null` sentinel) rather than inline.
  const resolve = (ref: string, seen: Set<string>): JsonSchema | null => {
    const target = defs.get(ref);
    if (target === undefined) return null; // dangling/non-local ref
    if (seen.has(ref)) return null; // cycle through the definitions pool
    return walk(target, new Set(seen).add(ref));
  };

  /** Recursively copy `node`, replacing `$ref` and dropping unrepresentable
   *  branches. Returns `null` when the whole node must be dropped (an
   *  un-inlinable `$ref`). */
  const walk = (node: unknown, seen: Set<string>): JsonSchema | null => {
    if (node === null || typeof node !== "object") {
      return node as unknown as JsonSchema;
    }
    if (Array.isArray(node)) {
      // Arrays appear under keywords like `prefixItems`/`anyOf`; a dropped
      // member would shift the contract, so keep array structure and let a
      // dropped member surface as the original node (best-effort).
      return node.map((m) => walk(m, seen) ?? m) as unknown as JsonSchema;
    }

    const obj = node as JsonSchema;
    if (typeof obj.$ref === "string") {
      const resolved = resolve(obj.$ref, seen);
      if (resolved === null) return null;
      // A `$ref` node carries no sibling constraints in Effect's output, so the
      // resolved schema replaces it wholesale.
      return resolved;
    }

    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(obj)) {
      // Divergence 1, second half: `additionalProperties: true` is what we ASKED
      // for, and an absent keyword already means "open" in JSON Schema — so the
      // explicit `true` is dropped, restoring the zod-era bytes. A non-`true`
      // value is kept: it would be a real constraint someone declared.
      if (key === "additionalProperties" && value === true) continue;
      if (key === "properties" && value !== null && typeof value === "object") {
        out.properties = walkProperties(value as JsonSchema, seen);
        continue;
      }
      const child = walk(value, seen);
      // A non-`properties` child that drops (e.g. `items: { $ref: … }` naming a
      // recursive definition) would otherwise leave a hole; keep the original so
      // the parent stays structurally valid rather than silently losing a keyword.
      out[key] = child ?? value;
    }
    // Prune at EVERY object node, not just the root: a dropped recursive
    // property can sit under a nested object too, leaving its `required`
    // array naming a property that no longer exists.
    return normalizeNumeric(pruneRequired(out));
  };

  /** Walk a `properties` map: a property whose schema dereferences to a
   *  drop (an un-inlinable recursive `$ref`) is OMITTED — the spec's "drop that
   *  property" rule. This is the one place a drop is the right move: a
   *  recursive *field* of an input is rare and a schema-less caller can't
   *  represent it anyway. */
  const walkProperties = (props: JsonSchema, seen: Set<string>): JsonSchema => {
    const out: JsonSchema = {};
    for (const [name, value] of Object.entries(props)) {
      const child = walk(value, seen);
      if (child !== null) out[name] = child;
    }
    return out;
  };

  // `walk` prunes `required` at every object node it builds (including the
  // root), so a dropped recursive property — wherever it sat — never leaves a
  // dangling `required` name behind.
  return walk(doc.schema, new Set()) ?? emptyObjectSchema();
}

/** Index every definition by the JSON-pointer ref string Effect's draft-2020-12
 *  output uses (`#/$defs/Inner`).
 *
 *  Divergence 5: the pool is a FIELD OF THE DOCUMENT (`Document.definitions`),
 *  not a `$defs` key on the root schema the way zod emitted it — so reading
 *  `$defs`/`definitions` off the schema object resolves nothing at all and
 *  every `$ref` would be silently dropped. */
function collectDefs(doc: JsonSchemaDocument): Map<string, JsonSchema> {
  const out = new Map<string, JsonSchema>();
  for (const [name, def] of Object.entries(doc.definitions)) {
    if (def !== null && typeof def === "object") {
      out.set(`#/$defs/${name}`, def as JsonSchema);
    }
  }
  return out;
}

/** The string sentinels `Schema.Number`'s encoded union admits alongside a JSON
 *  number, because JSON has no Infinity/NaN literal. */
const NON_FINITE_SENTINELS = ["Infinity", "-Infinity", "NaN"];

/** Divergence 2: collapse `Schema.Number`'s Infinity/NaN-tolerant `anyOf` back
 *  to its numeric arm.
 *
 *  Matched STRUCTURALLY and exactly — a two-member `anyOf` whose first member is
 *  numeric and whose second is precisely the sentinel string enum — so a
 *  hand-written union that merely resembles it is left alone. The numeric arm's
 *  own keywords (a `Schema.Number.check(...)`'s `allOf` bounds) survive, and so
 *  do the node's siblings (`description`, `default`), which win over the arm's. */
function normalizeNumeric(node: JsonSchema): JsonSchema {
  const anyOf = node.anyOf;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return node;
  const [numeric, sentinel] = anyOf as [unknown, unknown];
  if (!isRecord(numeric) || !isRecord(sentinel)) return node;
  if (numeric.type !== "number" && numeric.type !== "integer") return node;
  if (sentinel.type !== "string") return node;
  const values = sentinel.enum;
  if (
    !Array.isArray(values) ||
    values.length !== NON_FINITE_SENTINELS.length ||
    !NON_FINITE_SENTINELS.every((v) => values.includes(v))
  ) {
    return node;
  }
  const { anyOf: _collapsed, ...siblings } = node;
  return { ...numeric, ...siblings };
}

/** Drop any `required` name that no longer has a matching property (a
 *  recursive property was dropped during deref). Only touches a node that has
 *  both `properties` and a `required` array. */
function pruneRequired(node: JsonSchema): JsonSchema {
  const props = node.properties;
  const required = node.required;
  if (Array.isArray(required) && props !== null && typeof props === "object") {
    const present = required.filter(
      (name) => typeof name === "string" && name in (props as JsonSchema),
    );
    if (present.length === 0) {
      const { required: _drop, ...rest } = node;
      return rest;
    }
    return { ...node, required: present };
  }
  return node;
}

/** Ensure the top-level schema is an object — an advertised input must be. A
 *  scalar/array/union input (`Schema.String`, `Schema.Array(...)`) is wrapped
 *  under a single property so the verb still presents an object; the dispatch
 *  layer unwraps it (signalled by `wrapped: true`). The wrapping itself is
 *  {@link wrapSchema}'s — this decides WHETHER, not HOW. */
function enforceObject(schema: JsonSchema): {
  schema: JsonSchema;
  wrapped: boolean;
} {
  if (schema.type === "object") return { schema, wrapped: false };
  // An empty schema (`{}`, from an opaque declaration Effect cannot represent)
  // is most useful as "accept any object" rather than a wrapped scalar.
  if (Object.keys(schema).length === 0)
    return { schema: emptyObjectSchema(), wrapped: false };
  return { schema: wrapSchema(schema), wrapped: true };
}

// ── The client a face holds ──────────────────────────────────────────────

/** The structural shape of a served-surface client a PROJECTING FACE needs.
 *  The concrete client is what `buildSurfaceFace` mints (a wire link's face, the
 *  Solid client's `.rpc`, a `directDispatch`) — `.surface.<key>.<verb>(...)`,
 *  where a streaming verb returns a `Stream` and a unary one an `Effect`. Both
 *  are lazy: nothing dispatches until the face runs the value it was handed.
 *
 *  Declared here rather than reusing `SurfaceFace` (`@kolu/surface/client`)
 *  because a face string-indexes then *calls* the leaves
 *  (`client.surface[key].get(...)`), which `SurfaceFace`'s `unknown` leaves
 *  forbid; and re-materializing the precise `SurfaceClientOf<S>` overflows TS's
 *  union budget (the TS2590 dodge). Hence a callable-leaved structural shape:
 *  permissive enough that a concrete `SurfaceClientOf<S>` assigns without a
 *  cast, yet callable at the leaf.
 *
 *  It is HERE and not in either adapter because both adapters need exactly it,
 *  and a second structural spelling of one shape is a place two faces can
 *  disagree about what a client is. */
export type SurfaceClientCallable = {
  // biome-ignore lint/suspicious/noExplicitAny: the per-key call shape is the consumer's typed client; opaque here.
  surface: Record<string, Record<string, (...args: any[]) => any>>;
};

// ── Text in, declared type out ───────────────────────────────────────────

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
): Option.Option<unknown> {
  const decode = Schema.decodeUnknownOption(schema);
  const direct = decode(text);
  if (Option.isSome(direct)) return direct;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Option.none(); // not JSON — undecodable for a non-string schema
  }
  return decode(parsed);
}
