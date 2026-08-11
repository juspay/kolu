/**
 * Effect Schema → JSON-Schema, the load-bearing glue.
 *
 * Surface descriptors carry Effect Schemas; MCP tool inputs are JSON Schema.
 * Effect ships the converter natively (`Schema.toJsonSchemaDocument`, draft
 * 2020-12 — the dialect MCP standardized on), so the engine is *bought*. What
 * this module *owns* is the adapter glue around it, and that glue is bigger
 * than a taste preference: the MCP `tools/list` JSON Schema is on the repo's
 * byte-compatibility hit list (it is read by Anthropic, Gemini, Bedrock, Codex
 * and Claude Desktop), and Effect's converter diverges from the zod converter
 * this module was built on in five MEASURED ways. Each divergence and its fix
 * is named below; `jsonschema.test.ts` is the gate that keeps them fixed.
 *
 *   1. **Every object is CLOSED.** Effect emits `additionalProperties: false`
 *      on every object; zod emitted nothing. A closed tool input is an outright
 *      host break (a host that sends one extra key gets a validation failure),
 *      so the converter is asked for `additionalProperties: true` and the walk
 *      then DROPS the redundant `true` — absent already means open in JSON
 *      Schema, and dropping it restores the zod-era bytes exactly.
 *   2. **`Schema.Number` is Infinity/NaN-tolerant.** Its encoded form is
 *      `anyOf: [{type:"number"}, {type:"string", enum:["Infinity","-Infinity","NaN"]}]`
 *      — faithful to the codec, useless to an MCP host, which will happily
 *      offer the agent the string `"NaN"` as a legal argument. The faithful
 *      spellings for an MCP-facing numeric are `Schema.Finite` (`{type:"number"}`)
 *      and `Schema.Int` (`{type:"integer"}`); the walk additionally NORMALIZES
 *      the tolerant union back to its numeric arm, so a spec author who wrote
 *      plain `Schema.Number` cannot ship the union by accident. Normalizing is
 *      safe in one direction only, and this is that direction: it narrows what
 *      a host will *offer*, while the actual decode still runs against the real
 *      schema.
 *   3. **`Schema.Void` / `Schema.Undefined` encode as `{"type":"null"}`.** Fed
 *      through `enforceObject` that turns a NO-ARG tool into one demanding
 *      `{"value": null}`. They are special-cased to {@link emptyObjectSchema}
 *      BEFORE `enforceObject` ever sees them.
 *   4. **A DECODING default does not reach the document.** zod's
 *      `.default(v)` emitted `default: v`; Effect's `withDecodingDefaultKey` is
 *      a transformation, and the encoded document cannot see through it. What
 *      Effect *does* emit is the standard `default` ANNOTATION — but only when
 *      it sits on the ENCODED-side node, i.e. INSIDE `optionalKey`, before the
 *      decoding transformation. So the law for a defaulted MCP-facing field is
 *      `Schema.optionalKey(X.annotate({ default: v })).pipe(Schema.withDecodingDefaultKey(...))`,
 *      and the annotation placement is pinned by the tests (both the spelling
 *      that round-trips and the one that silently loses the keyword).
 *   5. **`$defs` live off the schema.** Effect returns a `Document`
 *      (`{dialect, schema, definitions}`): `$ref`s point at `#/$defs/<name>`
 *      while the pool is `Document.definitions`, NOT a `$defs` key on the root
 *      schema. {@link collectDefs} reads the document, not the schema object.
 *
 * On top of those, the two rules the module has always owned survive unchanged:
 *
 *   - a **dereference pass** that inlines every local `$ref` and strips the
 *     pool. `$ref` is rejected across a wide client matrix (Anthropic, Gemini,
 *     Bedrock, Codex, Claude Desktop) even though it is valid 2020-12 — the MCP
 *     TS SDK hit exactly this. Effect refs both REUSED and RECURSIVE schemas
 *     (any `identifier` annotation lands in `definitions`), and a recursive one
 *     cannot be inlined finitely, so the property carrying it is dropped rather
 *     than crashing the tool.
 *   - a top-level `{ type: "object" }` enforcement, wrapping a non-object input
 *     so every tool's `inputSchema` is the object shape MCP expects.
 *
 * One `toInputSchema()`, byte-pinned, because the converter's option defaults
 * are an effect-version seam exactly as zod's were.
 */

import type { WireSchemaAny } from "@kolu/surface/define";
import { Schema } from "effect";
import { wrapSchema } from "./wrapping";

/** A JSON-Schema document or sub-schema. We walk it structurally rather than
 *  typing every keyword, so `unknown`-valued records are the working shape. */
type JsonSchema = Record<string, unknown>;

/** The draft-2020-12 document Effect's converter returns: the root `schema`
 *  plus a SEPARATE `definitions` pool that `#/$defs/<name>` pointers address. */
type JsonSchemaDocument = ReturnType<typeof Schema.toJsonSchemaDocument>;

/** The empty-input schema — a tool that takes no args. MCP wants an object
 *  with no properties, not a missing/`true` schema. */
function emptyObjectSchema(): JsonSchema {
  return { type: "object", properties: {} };
}

/** Convert a descriptor's Effect Schema to an MCP tool `inputSchema`. With no
 *  schema (a no-arg procedure) returns the empty-object schema. Otherwise runs
 *  `Schema.toJsonSchemaDocument` with the pinned options, dereferences every
 *  local `$ref`, and enforces a top-level object. */
export function toInputSchema(schema?: WireSchemaAny): Record<string, unknown> {
  return inputSchema(schema).schema;
}

/** As `toInputSchema`, but also reports whether the original schema was a
 *  non-object (scalar/array/union) that had to be wrapped under a single
 *  `value` property to satisfy MCP's "tool input is an object" rule. The
 *  dispatch layer needs `wrapped` so it can unwrap `args.value` back into the
 *  bare value the procedure's schema actually expects (a `Schema.String` input
 *  is advertised as `{ value: string }`, but the procedure wants the string
 *  itself — see server.ts dispatch). */
export function inputSchema(schema?: WireSchemaAny): {
  schema: Record<string, unknown>;
  wrapped: boolean;
} {
  // Divergence 3: a NO-ARG member declares `Schema.Void` (what `defineSurface`
  // substitutes for an absent `input`), whose ENCODED form is `{"type":"null"}`.
  // Caught here, before `enforceObject` can wrap it into a tool that demands
  // `{"value": null}` from every host.
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
 *  `{"type":"null"}`, which is meaningless as a tool input. Checked on the AST
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
   *  recursive *field* of a tool input is rare and an MCP client can't
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
 *  `$defs`/`definitions` off the schema object (what this function used to do)
 *  resolves nothing at all and every `$ref` would be silently dropped. */
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

function isRecord(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

/** Ensure the top-level schema is an object — MCP tool inputs must be. A
 *  scalar/array/union input (`Schema.String`, `Schema.Array(...)`) is wrapped
 *  under a single property so the tool still presents an object to the host;
 *  the dispatch layer unwraps it (signalled by `wrapped: true`). The wrapping
 *  itself is `wrapping.ts`'s — this module decides WHETHER, not HOW. */
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
