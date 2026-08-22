/**
 * `@kolu/surface/verbs` — the projection vocabulary two faces share.
 *
 * What is pinned here is what a face READS off this module and cannot re-derive:
 * the flat name a procedure answers to, how a text token lands in a declared
 * type, and whether a member is addressable with no argument at all. Each is a
 * rule the MCP face and the CLI face both call in to, which is the whole reason
 * the module exists — so each one gets a pin, because a shared rule with no test
 * is a shared rule the two faces can silently stop agreeing about.
 *
 * The Schema → JSON-Schema bridge has its own file and its own pins
 * (`jsonSchemaBridge.test.ts`), where the byte fixture and the five converter
 * divergences live beside the volatility they hold.
 */

import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { admitsNoArgument, decodeTextValue, toolName } from "./verbs";

/** The `WireSchemaAny` bound `defineSurface` puts on every spec schema. Spelled
 *  here so a test schema can be handed over without a cast at each call site. */
const wire = (
  schema: Schema.Top,
): Schema.Codec<unknown, unknown, never, never> =>
  schema as unknown as Schema.Codec<unknown, unknown, never, never>;

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

describe("decodeTextValue", () => {
  it("lands a string token verbatim, in BOTH readings", () => {
    const got = decodeTextValue(wire(Schema.String), "42");
    expect(Option.getOrThrow(got)).toEqual({ encoded: "42", decoded: "42" });
  });

  it("falls back to the JSON reading for a numeric schema — and the ENCODED half is the PARSED value, not the token", () => {
    // The half a face forwards to a member's own client ref, which decodes what
    // it is handed, eagerly and synchronously: a raw "42" there throws at the
    // call site, which is a DEFECT — outside every arm of every error contract a
    // face publishes. Neither reading can be re-derived from the other, which is
    // why both travel.
    const got = decodeTextValue(wire(Schema.Int), "42");
    expect(Option.getOrThrow(got)).toEqual({ encoded: 42, decoded: 42 });
  });

  it("admits a literal by its verbatim reading, and refuses a token that lands in neither", () => {
    expect(
      Option.isSome(decodeTextValue(wire(Schema.Literals(["a", "b"])), "a")),
    ).toBe(true);
    expect(
      Option.isNone(decodeTextValue(wire(Schema.Int), "not-a-number")),
    ).toBe(true);
    // Not JSON at all, and not a string schema: undecodable by both paths.
    expect(
      Option.isNone(decodeTextValue(wire(Schema.Literals(["a"])), "b")),
    ).toBe(true);
  });
});

describe("admitsNoArgument", () => {
  it("admits the no-argument value exactly for a member that declares none", () => {
    // `Schema.Void` is what `defineSurface` mints for a member with no declared
    // input; its hand-written sibling is `Schema.Undefined`. Both are the shape
    // "there is nothing to pass".
    expect(admitsNoArgument(wire(Schema.Void))).toBe(true);
    expect(admitsNoArgument(wire(Schema.Undefined))).toBe(true);
  });

  it("refuses a member whose input is a struct or a scalar", () => {
    // The MCP face turns this `false` into a boot refusal (a static
    // `surface://…` URI carries no input); the CLI face turns it into a usage
    // error naming the argument. ONE predicate, two policies.
    expect(admitsNoArgument(wire(Schema.Struct({ id: Schema.String })))).toBe(
      false,
    );
    expect(admitsNoArgument(wire(Schema.String))).toBe(false);
  });

  it("refuses a struct whose every field is optional — the question is about the ARGUMENT, not the fields", () => {
    // "No argument at all" is not "an argument with nothing in it": `undefined`
    // is not an object, so an all-optional struct still wants `{}` passed. The
    // schema answers, and neither face second-guesses it from the shape.
    expect(
      admitsNoArgument(
        wire(Schema.Struct({ id: Schema.optionalKey(Schema.String) })),
      ),
    ).toBe(false);
  });
});
