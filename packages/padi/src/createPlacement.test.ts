/**
 * The create-placement rule, pinned at the wire.
 *
 * A create must STATE where the new terminal lands — a tile of its own, or a
 * split inside a named parent — and there is no default. The rule is enforced by
 * `PadiCreateInputSchema` itself rather than by a guard in `servePadi`, which is
 * what makes it unspellable rather than merely refused: a caller with no
 * placement fails at DECODE, before any handler runs, and a TypeScript caller
 * fails at compile time (pinned below with `@ts-expect-error`).
 *
 * Why it matters enough to break every existing bare create: a terminal's parent
 * edge is not decoration. The canvas nests a `child-of` terminal inside its
 * parent's tile, and the Dock reads the same edge as *who works for whom*. When
 * `parentId` was an optional key, "I didn't say" and "top level, please" were the
 * same request — so an orchestrator spawned two days of reviewer agents as
 * top-level tiles when every one of them was a split. Nothing failed; the
 * hierarchy just went flat. A required sum cannot express that silence.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PadiCreateInputSchema,
  parentIdOf,
  PLACEMENT_REQUIRED,
  TOPLEVEL_PLACEMENT,
} from "./surface.ts";

const PARENT = "11111111-1111-4111-8111-111111111111";

/** Decode a would-be wire payload, returning the refusal SENTENCE — or throwing
 *  a named error if it was accepted, so a regression can never pass vacuously. */
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
    // The two spellings, verbatim, so a caller can copy one.
    expect(text).toContain('{"kind":"toplevel"}');
    expect(text).toContain('{"kind":"child-of","parentId":"<terminal id>"}');
    // …and WHY, because a caller who did not know there was a decision to make
    // will otherwise pick whichever arm is listed first.
    expect(text).toContain("there is no default");
    expect(text).toContain("who-works-for-whom");
    // Effect's own default for an absent required key is the bare "Missing key",
    // which sends a script author hunting for a typo. `annotateKey`'s
    // `messageMissingKey` is what replaces it; this is that annotation's pin.
    expect(text).not.toContain("Missing key");
  });

  it("answers a create with NOTHING in it the same way", () => {
    expect(refusalOf({})).toContain(PLACEMENT_REQUIRED);
  });

  it("answers an INVENTED arm the same way — the vocabulary is closed", () => {
    // A caller who writes `{"kind":"split"}` has the same problem as one who
    // omitted the field: they don't know the words. Same answer, not a
    // schema-shaped one they would have to decode.
    expect(
      refusalOf({ placement: { kind: "split", parentId: PARENT } }),
    ).toContain(PLACEMENT_REQUIRED);
  });

  it("answers a `child-of` with no parent the same way — half a statement is not one", () => {
    expect(refusalOf({ placement: { kind: "child-of" } })).toContain(
      "Missing key",
    );
    // The path names the field that is missing, so the caller knows it is the
    // parent id and not the placement itself that went astray.
    expect(refusalOf({ placement: { kind: "child-of" } })).toContain(
      "parentId",
    );
  });

  it("refuses `parentId` at the TOP level — the old spelling is gone, not aliased", () => {
    // The migration is deliberate, not a compatibility shim: a caller still
    // passing the old flat `parentId` is told the rule rather than quietly
    // getting a top-level terminal (which is exactly the old bug, one field
    // over). The excess key is stripped by the decode, so what fires is the
    // missing `placement`.
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
    // The registry stores `parentId | undefined` because that is what the canvas
    // tree walks. This function is the single place the sum meets that shape, so
    // an `undefined` parent can only be produced by someone who wrote
    // `toplevel` — never by a dropped field.
    expect(parentIdOf(TOPLEVEL_PLACEMENT)).toBe(undefined);
    expect(parentIdOf({ kind: "child-of", parentId: PARENT })).toBe(PARENT);
  });

  it("the shared singleton is frozen — one value, never mutated in place", () => {
    expect(Object.isFrozen(TOPLEVEL_PLACEMENT)).toBe(true);
  });

  it("compile-time: a create with no placement is a TYPE error, not just a decode one", () => {
    // tsc typechecks this arrow's body whether or not it runs; it is never
    // invoked. The `@ts-expect-error` is the pin — if `placement` ever went
    // optional again, the error would vanish and tsc would fail on an UNUSED
    // `@ts-expect-error`, so the fence cannot silently rot.
    const _fence = (input: typeof PadiCreateInputSchema.Type): void =>
      void input;
    // @ts-expect-error — `placement` is required; a create cannot decline to say where it goes.
    void (() => _fence({ cwd: "/work/repo" }));
    void _fence;
    expect(typeof _fence).toBe("function");
  });
});
