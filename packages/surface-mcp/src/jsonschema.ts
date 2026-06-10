/**
 * zod → JSON-Schema, the load-bearing glue.
 *
 * Surface descriptors carry zod schemas; MCP tool inputs are JSON Schema.
 * zod 4 ships the converter natively (`z.toJSONSchema`, draft 2020-12 — the
 * dialect MCP standardized on), so the engine is *bought*. What this module
 * *owns* is the ~100 lines of adapter glue around it, set deliberately:
 *
 *   - `io: "input"` so a `.default()` arg isn't forced `required` (the wire
 *     accepts the default; only a no-default field is required).
 *   - `unrepresentable: "any"` so one `z.date()` degrades to `{}` (accept
 *     anything) rather than blanking the field or throwing `tools/list`.
 *   - a **dereference pass** that inlines every local `$ref`/`$defs` and
 *     strips them. zod still emits `$ref` on recursion and `.meta({ id })`,
 *     and `$ref` is rejected across a wide client matrix (Anthropic, Gemini,
 *     Bedrock, Codex, Claude Desktop) even though it's valid 2020-12 — the
 *     MCP TS SDK hit exactly this. A self-`$ref` to the document root (`#`,
 *     a genuinely recursive schema) can't be inlined finitely, so the
 *     property carrying it is dropped rather than crashing the tool.
 *   - a top-level `{ type: "object" }` enforcement, wrapping a non-object
 *     input so every tool's `inputSchema` is the object shape MCP expects.
 *
 * One `toInputSchema()`, snapshot-tested, because the option *defaults* are a
 * zod-version seam (4.3.x inlines reuse, 4.4 refs it).
 */

import { type ZodType, z } from "zod";

/** A JSON-Schema document or sub-schema. We walk it structurally rather than
 *  typing every keyword, so `unknown`-valued records are the working shape. */
type JsonSchema = Record<string, unknown>;

/** The empty-input schema — a tool that takes no args. MCP wants an object
 *  with no properties, not a missing/`true` schema. */
function emptyObjectSchema(): JsonSchema {
  return { type: "object", properties: {} };
}

/** Convert a descriptor's zod schema to an MCP tool `inputSchema`. With no
 *  schema (a no-arg procedure) returns the empty-object schema. Otherwise
 *  runs `z.toJSONSchema` with the pinned options, dereferences every local
 *  `$ref`, and enforces a top-level object. */
export function toInputSchema(schema?: ZodType): Record<string, unknown> {
  if (schema === undefined) return emptyObjectSchema();

  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
    reused: "inline",
    cycles: "ref",
  }) as JsonSchema;

  const dereferenced = dereference(raw);
  return enforceObject(dereferenced);
}

/** Inline every local `$ref` against the document's own `$defs`/`definitions`
 *  pools, then strip the pools. Returns a fresh tree; the input is not
 *  mutated. A `$ref` that resolves to the document root (`#`) is unbounded —
 *  the carrying property is dropped by the parent walker (see `walk`).
 *
 *  `$schema` and a stray top-level `id` (zod emits the latter for a
 *  `.meta({ id })` root) are dropped too: they're metadata, not constraints,
 *  and some clients are pickier than the spec. */
function dereference(doc: JsonSchema): JsonSchema {
  const defs = collectDefs(doc);

  // Guard against a pathological mutually-recursive `$defs` chain inflating
  // without bound: once we've expanded a given pointer on the current path,
  // a re-entry is a cycle we drop (the `null` sentinel) rather than inline.
  const resolve = (ref: string, seen: Set<string>): JsonSchema | null => {
    if (ref === "#") return null; // root self-ref: unbounded, can't inline
    const target = defs.get(ref);
    if (target === undefined) return null; // dangling/non-local ref
    if (seen.has(ref)) return null; // cycle through $defs
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
      // A `$ref` node carries no sibling constraints in zod's output, so the
      // resolved schema replaces it wholesale.
      return resolved;
    }

    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$defs" || key === "definitions") continue;
      if (key === "$schema" || key === "id") continue;
      if (key === "properties" && value !== null && typeof value === "object") {
        out.properties = walkProperties(value as JsonSchema, seen);
        continue;
      }
      const child = walk(value, seen);
      // A non-`properties` child that drops (e.g. `items: { $ref: "#" }`)
      // would otherwise leave a hole; keep the original so the parent stays
      // structurally valid rather than silently losing a keyword.
      out[key] = child ?? value;
    }
    return out;
  };

  /** Walk a `properties` map: a property whose schema dereferences to a
   *  drop (an un-inlinable self-`$ref`) is OMITTED — the spec's "drop that
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

  const result = walk(doc, new Set()) ?? emptyObjectSchema();
  // A dropped recursive property may leave it in `required`; prune.
  return pruneRequired(result);
}

/** Index every `$defs`/`definitions` entry by its JSON-pointer ref string
 *  (`#/$defs/Inner`), walking nested pools too. */
function collectDefs(doc: JsonSchema): Map<string, JsonSchema> {
  const out = new Map<string, JsonSchema>();
  const add = (poolKey: "$defs" | "definitions", node: JsonSchema): void => {
    const pool = node[poolKey];
    if (pool === null || typeof pool !== "object") return;
    for (const [name, def] of Object.entries(pool as JsonSchema)) {
      if (def !== null && typeof def === "object") {
        out.set(`#/${poolKey}/${name}`, def as JsonSchema);
      }
    }
  };
  add("$defs", doc);
  add("definitions", doc);
  return out;
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

/** Ensure the top-level schema is an object — MCP tool inputs must be. A zod
 *  scalar/array/union input (`z.string()`, `z.array(...)`) is wrapped under a
 *  single `value` property so the tool still presents an object to the host;
 *  the dispatch layer unwraps it. */
function enforceObject(schema: JsonSchema): JsonSchema {
  if (schema.type === "object") return schema;
  // An empty schema (`{}`, from a degraded `z.date()` at top level) is most
  // useful as "accept any object" rather than a wrapped scalar.
  if (Object.keys(schema).length === 0) return emptyObjectSchema();
  return {
    type: "object",
    properties: { value: schema },
    required: ["value"],
  };
}
