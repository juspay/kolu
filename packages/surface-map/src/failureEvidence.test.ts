/** The WIRE half of "reason without evidence is unspellable".
 *
 *  The type makes a failed arm without `evidence` a compile error
 *  (`entryConnectionState.test-d.ts`), but a type is erased at the boundary: a status
 *  arriving off the wire is only ever as constrained as the schema it parses through.
 *  So `entryStatusSchema`'s failed arm REQUIRES `evidence` too — enforcement at the
 *  codec, not by convention. These pins hold that: a failed status without evidence
 *  cannot be decoded at all, and one with it round-trips verbatim.
 *
 *  This is the pin that catches a future edit which relaxes the schema while leaving
 *  the type alone (or vice versa) — the exact shape of the juspay/kolu#2007 defect,
 *  where a reason could be held while its evidence had already been dropped. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { entryStatusSchema, MembershipIdSchema } from "./define";

const failureSchema = z.object({ cause: z.string(), reason: z.string() });
const statusSchema = entryStatusSchema(failureSchema);
const membershipId = MembershipIdSchema.parse("m1");
const failure = { cause: "remote-store-build-failed", reason: "build failed" };

describe("entryStatusSchema — the failed arm requires its evidence", () => {
  it("REFUSES a failed status carrying a reason but no evidence", () => {
    const parsed = statusSchema.safeParse({
      kind: "failed",
      membershipId,
      failure,
    });
    expect(parsed.success).toBe(false);
  });

  it("round-trips a failed status WITH its evidence tail", () => {
    const evidence = [
      { source: "local", line: "nix build …" },
      { source: "remote", line: "error: attribute 'foo' missing" },
    ];
    const parsed = statusSchema.parse({
      kind: "failed",
      membershipId,
      failure,
      evidence,
    });
    expect(parsed).toEqual({ kind: "failed", membershipId, failure, evidence });
  });

  it("accepts `[]` — the failure genuinely produced no output is a REAL value", () => {
    const parsed = statusSchema.parse({
      kind: "failed",
      membershipId,
      failure,
      evidence: [],
    });
    expect(parsed).toEqual({
      kind: "failed",
      membershipId,
      failure,
      evidence: [],
    });
  });

  it("REFUSES an evidence line with an unknown provenance (the vocabulary is closed)", () => {
    const parsed = statusSchema.safeParse({
      kind: "failed",
      membershipId,
      failure,
      evidence: [{ source: "somewhere-else", line: "x" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("leaves the UP arms alone — warming/connected carry no evidence field", () => {
    expect(statusSchema.parse({ kind: "warming", membershipId })).toEqual({
      kind: "warming",
      membershipId,
    });
    expect(
      statusSchema.parse({
        kind: "connected",
        membershipId,
        clockOffset: null,
      }),
    ).toEqual({ kind: "connected", membershipId, clockOffset: null });
  });
});
