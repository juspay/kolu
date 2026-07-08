/** The fold envelope must not depend on zod's missing-key leniency.
 *
 *  A void-input member's call folds to `{ mapKey }` — NO `input` key. The wire
 *  (JSON, and oRPC's own serializer) drops an `undefined` value, so the server
 *  sees the key absent. The OLD schema `z.object({ mapKey, input: z.void() })`
 *  only accepted that because zod <=4.3.6 treated a MISSING key as satisfying
 *  `z.void()`; zod >=4.3.7 REJECTS it ("expected nonoptional"), which silently
 *  broke every void-input fold over a real socket the moment a consumer's
 *  lockfile drifted onto a later zod patch (the drishti fleet incident). The fix:
 *  a void member's schema declares NO `input` field, so its absence can never be
 *  rejected — independent of zod's version. These pins hold that invariant. */

import {
  StandardRPCJsonSerializer,
  StandardRPCSerializer,
} from "@orpc/client/standard";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { foldInput } from "./define";
import {
  fold,
  INPUT_FIELD,
  MAP_KEY_FIELD,
  unfoldInput,
  unfoldKeyField,
} from "./envelope";

// The exact input transform a leaf call undergoes over a real oRPC socket.
const rpc = new StandardRPCSerializer(new StandardRPCJsonSerializer());
const overTheWire = (v: unknown): unknown =>
  rpc.deserialize(JSON.parse(JSON.stringify(rpc.serialize(v))));

describe("fold envelope — void input carries no key, independent of zod version", () => {
  it("fold(mapKey, undefined) emits NO input key; a real input keeps it", () => {
    const voidFrame = fold("remote:B", undefined) as Record<string, unknown>;
    expect(INPUT_FIELD in voidFrame).toBe(false);
    expect(voidFrame[MAP_KEY_FIELD]).toBe("remote:B");

    const inputFrame = fold("remote:B", { key: "k" }) as Record<
      string,
      unknown
    >;
    expect(inputFrame[INPUT_FIELD]).toEqual({ key: "k" });
  });

  it("the void-member schema has NO z.void() field — a missing key can't be strict-rejected", () => {
    // The OLD fragile schema rejects a non-void input value (and, on zod>=4.3.7,
    // a MISSING input key too). The NEW void schema has no input field at all, so
    // it neither rejects a missing key nor carries a z.void() for a stricter zod
    // to reject — a version-independent proof there's nothing to break.
    const fragile = z.object({
      [MAP_KEY_FIELD]: z.string(),
      [INPUT_FIELD]: z.void(),
    });
    expect(fragile.safeParse({ mapKey: "x", input: "junk" }).success).toBe(
      false,
    );
    expect(foldInput().safeParse({ mapKey: "x", input: "junk" }).success).toBe(
      true,
    );
    // The real case: the input KEY is absent (as the wire delivers it).
    expect(foldInput().safeParse({ mapKey: "x" }).success).toBe(true);
    // Explicit z.void()/z.undefined() inners collapse to the same no-input schema.
    expect(foldInput(z.void()).safeParse({ mapKey: "x" }).success).toBe(true);
    expect(foldInput(z.undefined()).safeParse({ mapKey: "x" }).success).toBe(
      true,
    );
  });

  it("a void frame survives the real serialize→JSON→deserialize round-trip and validates", () => {
    const wire = overTheWire(fold("remote:B", undefined));
    expect(INPUT_FIELD in (wire as Record<string, unknown>)).toBe(false);
    expect(foldInput().safeParse(wire).success).toBe(true);
    expect(unfoldKeyField(wire)).toBe("remote:B");
    expect(unfoldInput(wire)).toBeUndefined();
  });

  it("a member WITH input still carries + validates it across the round-trip", () => {
    const wire = overTheWire(fold("remote:B", { key: "k" }));
    const schema = foldInput(z.object({ key: z.string() }));
    expect(schema.safeParse(wire).success).toBe(true);
    expect(unfoldKeyField(wire)).toBe("remote:B");
    expect(unfoldInput(wire)).toEqual({ key: "k" });
    // A non-void member still enforces its input shape.
    expect(schema.safeParse({ mapKey: "x", input: { key: 1 } }).success).toBe(
      false,
    );
  });
});
