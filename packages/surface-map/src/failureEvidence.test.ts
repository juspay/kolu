/** The WIRE half of "reason without evidence is unspellable".
 *
 *  The type makes a failed arm without `evidence` a compile error
 *  (`entryConnectionState.test-d.ts`), but a type is erased at the boundary: a status
 *  arriving off the wire is only ever as constrained as the schema it decodes through.
 *  So `entryStatusSchema`'s failed arm REQUIRES `evidence` too — enforcement at the
 *  codec, not by convention. These pins hold that: a failed status without evidence
 *  cannot be decoded at all, and one with it round-trips verbatim — INCLUDING at the
 *  byte level, since this record crosses the ssh/relay hop between kolu and drishti.
 *
 *  This is the pin that catches a future edit which relaxes the schema while leaving
 *  the type alone (or vice versa) — the exact shape of the juspay/kolu#2007 defect,
 *  where a reason could be held while its evidence had already been dropped. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { entryStatusSchema } from "./define";
import { testMembershipId } from "./testing";

const failureSchema = Schema.Struct({
  cause: Schema.String,
  reason: Schema.String,
});
const statusSchema = entryStatusSchema(failureSchema);
const decode = Schema.decodeUnknownExit(statusSchema);
const decodes = (value: unknown) => decode(value)._tag === "Success";
const decodeSync = Schema.decodeUnknownSync(statusSchema);
const encodeSync = Schema.encodeUnknownSync(statusSchema);

const membershipId = testMembershipId("m1");
const failure = { cause: "remote-store-build-failed", reason: "build failed" };

describe("entryStatusSchema — the failed arm requires its evidence", () => {
  it("REFUSES a failed status carrying a reason but no evidence", () => {
    expect(decodes({ kind: "failed", membershipId, failure })).toBe(false);
  });

  it("round-trips a failed status WITH its evidence tail", () => {
    const evidence = [
      { source: "local", line: "nix build …" },
      { source: "remote", line: "error: attribute 'foo' missing" },
    ];
    expect(
      decodeSync({ kind: "failed", membershipId, failure, evidence }),
    ).toEqual({ kind: "failed", membershipId, failure, evidence });
  });

  it("accepts `[]` — the failure genuinely produced no output is a REAL value", () => {
    expect(
      decodeSync({ kind: "failed", membershipId, failure, evidence: [] }),
    ).toEqual({ kind: "failed", membershipId, failure, evidence: [] });
  });

  it("REFUSES an evidence line with an unknown provenance (the vocabulary is closed)", () => {
    expect(
      decodes({
        kind: "failed",
        membershipId,
        failure,
        evidence: [{ source: "somewhere-else", line: "x" }],
      }),
    ).toBe(false);
  });

  it("REFUSES an empty membershipId — the runtime half of the brand", () => {
    expect(decodes({ kind: "warming", membershipId: "" })).toBe(false);
  });

  it("leaves the UP arms alone — warming/connected carry no evidence field", () => {
    expect(decodeSync({ kind: "warming", membershipId })).toEqual({
      kind: "warming",
      membershipId,
    });
    expect(
      decodeSync({ kind: "connected", membershipId, clockOffset: null }),
    ).toEqual({ kind: "connected", membershipId, clockOffset: null });
  });
});

describe("entryStatusSchema — the ENCODED bytes (this record crosses the relay hop)", () => {
  // The status travels kolu → ssh/relay → drishti, so its encoded spelling is a wire
  // format, not an internal detail. Pinned as literal JSON strings: the discriminant
  // stays `kind` (NOT `_tag` — this is a `Schema.Union` of `Struct`s, deliberately not
  // a `TaggedUnion`), no key is reordered or dropped, and `clockOffset: null` stays a
  // real `null` rather than becoming an absent key.
  it("encodes each arm byte-for-byte as the zod original did", () => {
    expect(JSON.stringify(encodeSync({ kind: "warming", membershipId }))).toBe(
      '{"kind":"warming","membershipId":"m1"}',
    );
    expect(
      JSON.stringify(
        encodeSync({ kind: "connected", membershipId, clockOffset: null }),
      ),
    ).toBe('{"kind":"connected","membershipId":"m1","clockOffset":null}');
    expect(
      JSON.stringify(
        encodeSync({ kind: "connected", membershipId, clockOffset: 42 }),
      ),
    ).toBe('{"kind":"connected","membershipId":"m1","clockOffset":42}');
    expect(
      JSON.stringify(
        encodeSync({
          kind: "failed",
          membershipId,
          failure,
          evidence: [{ source: "local", line: "boom" }],
        }),
      ),
    ).toBe(
      '{"kind":"failed","membershipId":"m1",' +
        '"failure":{"cause":"remote-store-build-failed","reason":"build failed"},' +
        '"evidence":[{"source":"local","line":"boom"}]}',
    );
  });

  it("an ABSENT optional `connection` stays absent — never `null` (#17)", () => {
    // `Schema.optionalKey`, not `Schema.optional`: the latter admits an explicit
    // `undefined` and JSON-encodes it as `null`, where the zod original simply omitted
    // the key. A relay hop that re-encoded `null` here would hand drishti a
    // `connection` field the shape says is absent.
    const withConn = entryStatusSchema(
      failureSchema,
      Schema.Struct({ phase: Schema.String }),
    );
    const enc = Schema.encodeUnknownSync(withConn);
    expect(JSON.stringify(enc({ kind: "warming", membershipId }))).toBe(
      '{"kind":"warming","membershipId":"m1"}',
    );
    expect(
      JSON.stringify(
        enc({
          kind: "warming",
          membershipId,
          connection: { phase: "provisioning" },
        }),
      ),
    ).toBe(
      '{"kind":"warming","membershipId":"m1","connection":{"phase":"provisioning"}}',
    );
  });
});
