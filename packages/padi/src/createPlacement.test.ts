import {
  PadiCreateInputSchema,
  PLACEMENT_REQUIRED,
  parentIdOf,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const PARENT = "11111111-1111-4111-8111-111111111111";

function refusalOf(input: unknown): string {
  try {
    Schema.decodeUnknownSync(PadiCreateInputSchema)(input);
  } catch (e) {
    return String(e);
  }
  throw new Error(
    `expected the wire to refuse ${JSON.stringify(input)}; it was accepted`,
  );
}

describe("lifecycle.create refuses a request that states no placement", () => {
  it("names BOTH spellings and the rule — never just 'missing key'", () => {
    const text = refusalOf({ cwd: "/work/repo" });
    expect(text).toContain('{"kind":"toplevel"}');
    expect(text).toContain('{"kind":"child-of","parentId":"<terminal id>"}');
    expect(text).toContain("there is no default");
    expect(text).toContain("who-works-for-whom");
    expect(text).not.toContain("Missing key");
  });

  it("answers a create with NOTHING in it the same way", () => {
    expect(refusalOf({})).toContain(PLACEMENT_REQUIRED);
  });

  it("answers an INVENTED arm the same way — the vocabulary is closed", () => {
    expect(
      refusalOf({ placement: { kind: "split", parentId: PARENT } }),
    ).toContain(PLACEMENT_REQUIRED);
  });

  it("answers a `child-of` with no parent DIFFERENTLY — and that is the point", () => {
    const text = refusalOf({ placement: { kind: "child-of" } });
    expect(text).toContain("Missing key");
    expect(text).toContain("parentId");
    expect(text).not.toContain(PLACEMENT_REQUIRED);
  });

  it("refuses `parentId` at the TOP level — the old spelling is gone, not aliased", () => {
    expect(refusalOf({ parentId: PARENT })).toContain(PLACEMENT_REQUIRED);
  });
});

describe("lifecycle.create accepts either stated placement", () => {
  const decode = Schema.decodeUnknownSync(PadiCreateInputSchema);

  it("top level — a tile of its own", () => {
    expect(decode({ placement: { kind: "toplevel" } })).toEqual({
      placement: { kind: "toplevel" },
    });
  });

  it("child-of — a split inside a named terminal", () => {
    expect(
      decode({ placement: { kind: "child-of", parentId: PARENT }, cwd: "/w" }),
    ).toEqual({
      placement: { kind: "child-of", parentId: PARENT },
      cwd: "/w",
    });
  });

  it("`parentIdOf` is the ONE narrowing from stated intent to the stored edge", () => {
    expect(parentIdOf(TOPLEVEL_PLACEMENT)).toBe(undefined);
    expect(parentIdOf({ kind: "child-of", parentId: PARENT })).toBe(PARENT);
  });

  it("the shared singleton is frozen — one value, never mutated in place", () => {
    expect(Object.isFrozen(TOPLEVEL_PLACEMENT)).toBe(true);
  });

  it("compile-time: a create with no placement is a TYPE error, not just a decode one", () => {
    type CreateInput = typeof PadiCreateInputSchema.Type;
    const placementRequired: { readonly cwd: string } extends CreateInput
      ? false
      : true = true;
    expect(placementRequired).toBe(true);
  });
});
