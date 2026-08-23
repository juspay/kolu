/**
 * The Effect Schema → JSON-Schema BRIDGE, and the wrapping rule that rides with
 * it — how an input is described to a caller that speaks no Effect Schema.
 *
 * A file of its own, under `@kolu/surface/verbs`'s one import path (it
 * re-exports every name below), because this is the VOLATILE half of the
 * projection vocabulary and nothing else in that module is: a verb record and a
 * flat name have no version seam at all, while the converter's option defaults
 * and its representation choices shift between effect betas exactly as zod's
 * did — with a byte fixture standing over them. Keeping the seam in its own
 * module says which half moves.
 *
 * ## The five divergences it pins
 *
 * Surface descriptors carry Effect Schemas; a schema-less caller wants JSON
 * Schema. Effect ships the converter natively (`Schema.toJsonSchemaDocument`,
 * draft 2020-12 — the dialect MCP standardized on), so the engine is *bought*.
 * What this module *owns* is the adapter glue around it, and that glue is
 * bigger than a taste preference: the MCP `tools/list` JSON Schema is on the
 * repo's byte-compatibility hit list (it is read by Anthropic, Gemini, Bedrock,
 * Codex and Claude Desktop), and Effect's converter diverges from the zod
 * converter this code was built on in five MEASURED ways. Each divergence and
 * its fix is named below; `jsonSchemaBridge.test.ts` is the gate that keeps them
 * fixed.
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
 *     cannot be inlined finitely, so the PROPERTY carrying it is dropped rather
 *     than crashing the verb, and a self-reference anywhere else — a tree whose
 *     children are an array, a recursive `anyOf` arm — degrades to an
 *     accept-anything `{}`. What must never happen is the one thing this pass
 *     exists to prevent: shipping a `$ref` into a document whose pool has been
 *     stripped.
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
 * The INPUT half is every face's, though the two faces use different ends of
 * it: the MCP face undoes the wrap with {@link unwrapArgs}, while the CLI face
 * never wraps at all — it reads {@link AdvertisedInput}'s `inner` and binds the
 * bare value to one flag or a positional. The RESULT half is the MCP face's
 * alone today, and it stays beside its siblings because all three read one key.
 * The two edges are NOT one predicate, and that is worth stating plainly
 * because the shape of it is user-visible — see {@link wrapValue}.
 */

import { Schema } from "effect";
import type { WireSchemaAny } from "./define";

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Advertise a non-object INPUT as an object with one property. Decided from
 *  the DECLARED schema, so `wrapped` is a static bit a face carries and
 *  {@link unwrapArgs} reads back. */
function wrapSchema(schema: JsonSchema): JsonSchema {
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

/** What an advertised input looks like, plus the two facts a projecting face
 *  needs beside it.
 *
 *  `wrapped` says the original schema was a non-object (scalar/array/union) that
 *  had to travel under a single property, so a dispatching face can
 *  {@link unwrapArgs} back into the bare value the verb's schema expects (a
 *  `Schema.String` input is advertised as `{ value: string }`, but the procedure
 *  wants the string itself).
 *
 *  `inner` is that wrapped value's OWN node, handed over so a face never has to
 *  NAME the wrapper property: `@kolu/surface-cli` binds a wrapped input to a
 *  positional whose type it reads off this node, and the key the value travels
 *  under stays private to this module — which is the whole reason the key is
 *  private.
 *
 *  A UNION on `wrapped`, so "present exactly when `wrapped` is true" is what the
 *  type SAYS rather than what its doc comment claims. As a product with an
 *  optional field it admitted two states the domain has never had
 *  (`{wrapped:true, inner:undefined}` and `{wrapped:false, inner:{…}}`), and
 *  both consumers paid for them in a `??` fallback over a case that cannot
 *  happen — one of them inside the `if (wrapped)` branch that had already ruled
 *  it out. Narrowing on `wrapped` now hands a face exactly the fields that arm
 *  has. */
export type AdvertisedInput =
  | { readonly schema: Record<string, unknown>; readonly wrapped: false }
  | {
      readonly schema: Record<string, unknown>;
      readonly wrapped: true;
      readonly inner: Record<string, unknown>;
    };

/** As {@link toInputSchema}, but with the facts above beside the document. */
export function inputSchema(schema?: WireSchemaAny): AdvertisedInput {
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

/** What an un-inlinable `$ref` becomes OUTSIDE a `properties` map: the empty
 *  schema, which in JSON Schema accepts anything.
 *
 *  The same degradation {@link enforceObject} already uses for a declaration
 *  Effect cannot represent, and it is the only honest one here. The pool is
 *  stripped from the emitted document, so the alternatives are a pointer to a
 *  definition that is not there (invalid, and rejected across the client
 *  matrix), or dropping the keyword and silently changing what the parent means.
 *  Accepting anything loses a CONSTRAINT and keeps the document true. */
const ACCEPT_ANYTHING: JsonSchema = {};

/** Inline every local `$ref` against the document's own `definitions` pool,
 *  then strip the pool. Returns a fresh tree; the input is not mutated.
 *
 *  A `$ref` that cannot be inlined finitely (a recursive schema, which Effect
 *  always emits as a self-referencing definition) is dropped WHOLE where it is a
 *  property — see `walkProperties`, the one position where dropping is the right
 *  move — and degrades to {@link ACCEPT_ANYTHING} everywhere else. No `$ref`
 *  survives either way, which is the one property this pass owes its callers. */
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
      // Arrays appear under keywords like `prefixItems`/`anyOf`; dropping a
      // MEMBER would shift the contract (an `anyOf`'s arms are positional to a
      // reader, and `prefixItems` literally is), so the structure is kept and an
      // un-inlinable member degrades to {@link ACCEPT_ANYTHING} in place.
      return node.map(
        (m) => walk(m, seen) ?? ACCEPT_ANYTHING,
      ) as unknown as JsonSchema;
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
      // A non-`properties` child that drops (`items: { $ref: … }` naming a
      // recursive definition — the ordinary shape of a tree whose children are
      // an ARRAY) must not leave a hole, and must not be put BACK: the original
      // is the un-inlinable `$ref` itself, and the pool it points at is stripped
      // from the document a line later, so keeping it shipped a pointer to a
      // `#/$defs/…` that is not there — the exact shape this whole pass exists
      // to remove, and one a wide client matrix rejects outright. It degrades to
      // {@link ACCEPT_ANYTHING} instead: the keyword survives, the parent stays
      // structurally valid, and what is lost is a constraint rather than the
      // document's validity.
      out[key] = child ?? ACCEPT_ANYTHING;
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
 *  {@link wrapSchema}'s — this decides WHETHER, not HOW — and the wrapped node
 *  travels out as {@link AdvertisedInput}'s `inner`, so no face has to reach
 *  back through the wrapper by name. */
function enforceObject(schema: JsonSchema): AdvertisedInput {
  if (schema.type === "object") return { schema, wrapped: false };
  // An empty schema (`{}`, from an opaque declaration Effect cannot represent)
  // is most useful as "accept any object" rather than a wrapped scalar.
  if (Object.keys(schema).length === 0)
    return { schema: emptyObjectSchema(), wrapped: false };
  return { schema: wrapSchema(schema), wrapped: true, inner: schema };
}
