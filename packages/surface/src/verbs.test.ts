/**
 * `@kolu/surface/verbs` — the projection vocabulary two faces share.
 *
 * The bulk of it pins `toInputSchema`, the Effect Schema → JSON-Schema glue.
 * These pins are the effect-version seam (the converter's option defaults and
 * its representation choices shift between betas exactly as zod's did): a
 * regression here ships a verb whose advertised input an MCP client rejects —
 * and now also one whose CLI flags are the wrong shape.
 *
 * The MCP `tools/list` JSON Schema is on the repo's byte-compatibility hit list,
 * so the five MEASURED divergences between Effect's converter and the zod one
 * this module was built on each get a named pin below, and the whole emitted
 * string gets a byte-level fixture at the end. Those pins moved here VERBATIM
 * from `@kolu/surface-mcp`'s `jsonschema.test.ts` when the bridge moved: the
 * assertions are unchanged, which is what makes them proof that the move
 * changed no behaviour.
 *
 * `toolName` and the wrapping rule get their own pins at the foot — they became
 * public framework API with this move, and a public export the reference
 * documents is one a test has to hold to.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  inputSchema,
  toInputSchema,
  toolName,
  unwrapArgs,
  wrapValue,
} from "./verbs";

/** The `WireSchemaAny` bound `defineSurface` puts on every spec schema. Spelled
 *  here so a test schema can be handed to the converter without a cast at each
 *  call site. */
const wire = (
  schema: Schema.Top,
): Schema.Codec<unknown, unknown, never, never> =>
  schema as unknown as Schema.Codec<unknown, unknown, never, never>;

describe("toInputSchema", () => {
  it("no schema → empty object schema (a no-arg procedure)", () => {
    expect(toInputSchema()).toEqual({ type: "object", properties: {} });
  });

  it("Schema.Void / Schema.Undefined → empty object schema, NOT a `value: null` demand (divergence 3)", () => {
    // Effect encodes both as `{"type":"null"}`. Left alone, `enforceObject` would
    // wrap that into `{type:"object", properties:{value:{type:"null"}}, required:["value"]}`
    // and every host would have to send `{"value": null}` to call a NO-ARG tool.
    expect(toInputSchema(wire(Schema.Void))).toEqual({
      type: "object",
      properties: {},
    });
    expect(toInputSchema(wire(Schema.Undefined))).toEqual({
      type: "object",
      properties: {},
    });
    // A genuine `Schema.Null` FIELD keeps its honest `{"type":"null"}` — the
    // special case is on the schema's identity, not on the emitted shape.
    const out = toInputSchema(wire(Schema.Struct({ n: Schema.Null })));
    expect((out.properties as Record<string, unknown>).n).toEqual({
      type: "null",
    });
  });

  it("a defaulted field is NOT required and keeps its `default` (divergence 4)", () => {
    // The law for a defaulted MCP-facing field: the `default` ANNOTATION sits on
    // the ENCODED-side node, INSIDE `optionalKey`, before the decoding
    // transformation — that is the only placement the encoded document can see.
    const schema = Schema.Struct({
      strict: Schema.optionalKey(
        Schema.Boolean.annotate({ default: true }),
      ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
      name: Schema.String,
    });
    const out = toInputSchema(wire(schema));
    expect(out.type).toBe("object");
    // `name` has no default → required; `strict` defaults → not required.
    expect(out.required).toEqual(["name"]);
    const props = out.properties as Record<string, unknown>;
    expect(props.strict).toMatchObject({ type: "boolean", default: true });
  });

  it("annotating AFTER the decoding transformation silently loses the default (the negative half of divergence 4)", () => {
    // Pinned so the placement rule above is a tested fact rather than folklore:
    // an annotation applied to the post-transformation node is not reachable from
    // the ENCODED document, so the keyword vanishes. If a future beta starts
    // carrying it through, this test fails and the law can be relaxed on purpose.
    const schema = Schema.Struct({
      strict: Schema.optionalKey(Schema.Boolean)
        .pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))
        .annotate({ default: true }),
      name: Schema.String,
    });
    const props = toInputSchema(wire(schema)).properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.strict).toEqual({ type: "boolean" });
    expect("default" in (props.strict ?? {})).toBe(false);
  });

  it("tool inputs stay OPEN — no additionalProperties:false (divergence 1)", () => {
    // Effect closes EVERY object by default. A closed tool input is a host break:
    // one extra key from the agent and the call fails validation. The converter is
    // asked for open objects and the redundant `true` is dropped, so the emitted
    // bytes carry no `additionalProperties` at all — absent already means open.
    const schema = Schema.Struct({
      a: Schema.String,
      nested: Schema.Struct({ b: Schema.String }),
    });
    const json = JSON.stringify(toInputSchema(wire(schema)));
    expect(json).not.toContain("additionalProperties");
  });

  it("an MCP-facing numeric is a plain number/integer, never the Infinity-tolerant union (divergence 2)", () => {
    const schema = Schema.Struct({
      // The faithful spellings.
      finite: Schema.Finite,
      whole: Schema.Int,
      // The accidental one — normalized back to its numeric arm rather than
      // offering the agent the string "NaN" as a legal argument.
      loose: Schema.Number,
      // Constraints on the numeric arm survive the collapse.
      bounded: Schema.Number.check(Schema.isGreaterThan(0)),
      // Nested inside a container, so the normalization is proven to be a walk,
      // not a top-level special case.
      many: Schema.Array(Schema.Number),
    });
    const out = toInputSchema(wire(schema));
    const props = out.properties as Record<string, Record<string, unknown>>;

    expect(props.finite).toEqual({ type: "number" });
    expect(props.whole).toEqual({ type: "integer" });
    expect(props.loose).toEqual({ type: "number" });
    expect(props.bounded).toMatchObject({ type: "number" });
    expect(props.many).toEqual({ type: "array", items: { type: "number" } });

    // Nothing anywhere still advertises the sentinel strings.
    const json = JSON.stringify(out);
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("NaN");
  });

  it("a hand-written union that merely resembles the numeric one is left alone", () => {
    const out = toInputSchema(
      wire(
        Schema.Struct({
          either: Schema.Union([Schema.Finite, Schema.String]),
        }),
      ),
    );
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.either).toEqual({
      anyOf: [{ type: "number" }, { type: "string" }],
    });
  });

  it("inlines a $ref for a reused (identified) nested object — no $ref/$defs left (divergence 5)", () => {
    const Inner = Schema.Struct({ x: Schema.Finite }).annotate({
      identifier: "Inner",
    });
    const Outer = Schema.Struct({ a: Inner, b: Inner });
    const out = toInputSchema(wire(Outer));

    const json = JSON.stringify(out);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$defs");
    expect(json).not.toContain("definitions");

    const props = out.properties as Record<string, Record<string, unknown>>;
    // Both `a` and `b` carry the full inlined Inner object.
    expect(props.a).toMatchObject({
      type: "object",
      properties: { x: { type: "number" } },
    });
    expect(props.b).toMatchObject({
      type: "object",
      properties: { x: { type: "number" } },
    });
  });

  it("a recursive schema doesn't crash and emits no $ref", () => {
    interface Rec {
      readonly name: string;
      readonly next?: Rec | undefined;
    }
    const Node: Schema.Codec<Rec> = Schema.Struct({
      name: Schema.String,
      next: Schema.optionalKey(Schema.suspend((): Schema.Codec<Rec> => Node)),
    }).annotate({ identifier: "RecNode" }) as unknown as Schema.Codec<Rec>;

    const out = toInputSchema(wire(Node));
    const json = JSON.stringify(out);
    // The recursive `next` property is dropped (an un-inlinable self-ref);
    // the schema is still a valid object with `name`. Effect emits the ROOT
    // itself as a `$ref` into the definitions pool for a recursive schema, so
    // this also pins that the root ref is resolved rather than dropped whole.
    expect(json).not.toContain("$ref");
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.name).toMatchObject({ type: "string" });
    expect("next" in props).toBe(false);
    // `name` was required and survives; `next` (if it had been required) is
    // pruned — required must only name present properties.
    if (Array.isArray(out.required)) {
      for (const r of out.required) expect(r in props).toBe(true);
    }
  });

  it("an opaque declaration degrades to an accept-anything {} rather than throwing", () => {
    class Opaque {
      constructor(readonly x: number) {}
    }
    const schema = Schema.Struct({
      thing: Schema.declare((u): u is Opaque => u instanceof Opaque),
      label: Schema.String,
    });
    expect(() => toInputSchema(wire(schema))).not.toThrow();
    const props = toInputSchema(wire(schema)).properties as Record<
      string,
      unknown
    >;
    expect(props.thing).toEqual({});
    expect(props.label).toMatchObject({ type: "string" });
  });

  it("a Date is advertised as its WIRE form (a string), not blanked", () => {
    // Deliberate improvement over the zod era, recorded rather than absorbed:
    // zod had no representation for `z.date()` and the glue degraded it to `{}`
    // via `unrepresentable: "any"`. An Effect `Schema.Date` is a CODEC whose
    // encoded side is an ISO string, and that is exactly what a host must send —
    // so the honest advertisement is `{type:"string"}`, not "accept anything".
    const out = toInputSchema(
      wire(Schema.Struct({ when: Schema.Date, label: Schema.String })),
    );
    const props = out.properties as Record<string, unknown>;
    expect(props.when).toEqual({ type: "string" });
    expect(props.label).toMatchObject({ type: "string" });
  });

  it("wraps a top-level non-object input under `value`", () => {
    const out = toInputSchema(wire(Schema.String));
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.value).toMatchObject({ type: "string" });
    expect(out.required).toEqual(["value"]);
  });

  it("wraps a top-level array input under `value`", () => {
    const out = toInputSchema(wire(Schema.Array(Schema.String)));
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.value).toMatchObject({ type: "array" });
  });

  it("carries no $schema metadata at the top level", () => {
    const out = toInputSchema(wire(Schema.Struct({ a: Schema.Finite })));
    expect("$schema" in out).toBe(false);
  });

  it("prunes required for a recursive property dropped under a NESTED object (F11)", () => {
    // The recursive schema sits under a nested `wrapper` object, not the root.
    // When its self-ref `child` property is dropped, the NESTED object's
    // `required` must not still name `child`.
    interface Tree {
      readonly label: string;
      readonly child: Tree;
    }
    const Node: Schema.Codec<Tree> = Schema.Struct({
      label: Schema.String,
      child: Schema.suspend((): Schema.Codec<Tree> => Node),
    }).annotate({ identifier: "TreeNode" }) as unknown as Schema.Codec<Tree>;

    const schema = Schema.Struct({
      wrapper: Schema.Struct({ inner: Node }),
    });
    const out = toInputSchema(wire(schema));
    const json = JSON.stringify(out);
    expect(json).not.toContain("$ref");

    // Walk every object node — no `required` entry may name an absent property.
    const checkNode = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      const props = obj.properties as Record<string, unknown> | undefined;
      if (Array.isArray(obj.required) && props !== undefined) {
        for (const name of obj.required) {
          expect(name in props).toBe(true);
        }
      }
      for (const v of Object.values(obj)) checkNode(v);
      if (props) for (const v of Object.values(props)) checkNode(v);
    };
    checkNode(out);
  });

  it("inputSchema reports whether a non-object input was wrapped (F3)", () => {
    // A scalar/array/union is wrapped under `value` → wrapped: true.
    expect(inputSchema(wire(Schema.String)).wrapped).toBe(true);
    expect(inputSchema(wire(Schema.Array(Schema.Finite))).wrapped).toBe(true);
    // An object input, a `Schema.Void` input and a no-arg procedure are NOT
    // wrapped.
    expect(inputSchema(wire(Schema.Struct({ a: Schema.Finite }))).wrapped).toBe(
      false,
    );
    expect(inputSchema(wire(Schema.Void)).wrapped).toBe(false);
    expect(inputSchema(undefined).wrapped).toBe(false);
  });

  it("BYTE FIXTURE — the exact emitted string for a representative tool input", () => {
    // The MCP `tools/list` JSON Schema is on the byte-compatibility hit list, so
    // this pins the emitted STRING, not just decode-equality. Two intentional
    // deltas against the zod-era bytes are recorded here rather than hidden:
    //
    //   - `strict` spells `{"type":"boolean","default":true}` where zod spelled
    //     `{"default":true,"type":"boolean"}` — key ORDER only, which JSON does
    //     not treat as semantic and no MCP host reads positionally;
    //   - `whole` is a bare `{"type":"integer"}` where zod additionally emitted
    //     `minimum`/`maximum` at the safe-integer bounds. `Schema.Int` declares
    //     integrality and nothing else, and advertising bounds the schema does
    //     not enforce would be the converter lying on the schema's behalf.
    //
    // Everything else — property order, `required` order, the absence of
    // `additionalProperties` and `$schema` — is byte-identical to the zod era.
    const schema = Schema.Struct({
      name: Schema.String,
      strict: Schema.optionalKey(
        Schema.Boolean.annotate({ default: true }),
      ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
      count: Schema.Finite,
      whole: Schema.Int,
      tags: Schema.Array(Schema.String),
      mode: Schema.Literals(["a", "b"]),
      note: Schema.optionalKey(Schema.String),
      nested: Schema.Struct({ x: Schema.Finite }),
    });

    expect(JSON.stringify(toInputSchema(wire(schema)))).toBe(
      '{"type":"object","properties":{"name":{"type":"string"},"strict":{"type":"boolean","default":true},"count":{"type":"number"},"whole":{"type":"integer"},"tags":{"type":"array","items":{"type":"string"}},"mode":{"type":"string","enum":["a","b"]},"note":{"type":"string"},"nested":{"type":"object","properties":{"x":{"type":"number"}},"required":["x"]}},"required":["name","count","whole","tags","mode","nested"]}',
    );
  });
});

describe("toolName", () => {
  it("joins a namespace and a verb with the one separator a dotless face has", () => {
    expect(toolName("git", "commit")).toBe("git_commit");
  });

  it("rewrites ONLY the separator — a dotted namespace keeps its dots", () => {
    // The name has to be reversible to one `(ns, verb)` pair. Rewriting every
    // dot would collapse `a.b`·`c` and `a`·`b.c` onto one verb.
    expect(toolName("a.b", "c")).toBe("a.b_c");
    expect(toolName("a", "b.c")).toBe("a_b.c");
  });
});

describe("the wrapping rule", () => {
  it("unwraps exactly when the advertised input was wrapped", () => {
    // `wrapped` is the static bit `inputSchema` reported for that input, never a
    // guess about the value: a bare object input passes through untouched, and a
    // wrapped scalar comes back out of `value`.
    expect(unwrapArgs(false, { pid: 7 })).toEqual({ pid: 7 });
    expect(unwrapArgs(true, { value: "abc" })).toBe("abc");
  });

  it("wraps a result JSON renders as a non-object, and only then", () => {
    expect(wrapValue({ ok: true })).toEqual({ ok: true });
    expect(wrapValue(42)).toEqual({ value: 42 });
    expect(wrapValue(null)).toEqual({ value: null });
    expect(wrapValue(["a", "b"])).toEqual({ value: ["a", "b"] });
  });

  it("advertises a scalar input under the SAME key `unwrapArgs` reads back", () => {
    // The two halves of the rule, joined: whatever `inputSchema` names the
    // wrapper property, `unwrapArgs` is the undo — nothing outside the module
    // has to know the spelling for the round trip to hold.
    const built = inputSchema(
      Schema.String as unknown as Schema.Codec<unknown, unknown, never, never>,
    );
    expect(built.wrapped).toBe(true);
    const [key] = Object.keys(
      (built.schema as { properties: Record<string, unknown> }).properties,
    );
    expect(unwrapArgs(built.wrapped, { [key as string]: "abc" })).toBe("abc");
  });
});
