/**
 * Shape-pin for kaval's legacy `system.version` output. Supervisor identity now
 * rides the frozen control fragment, but this procedure stays byte-for-byte
 * unchanged for existing pid/lifetime/build-readout consumers.
 *
 * Unknown keys are stripped on decode (as zod stripped them), so exact key pins
 * make an accidental wire edit fail loudly. The optionality pins are the #17 law
 * in executable form: `Schema.optionalKey`, never `Schema.optional` — absent must
 * ENCODE ABSENT, not `null`, which is a state no reader of this handshake has an
 * arm for.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PtyHostIdentitySchema,
  SystemVersionOutputSchema,
} from "./ptyHostSurface.ts";

const decode = Schema.decodeUnknownSync(SystemVersionOutputSchema);
const encode = Schema.encodeUnknownSync(SystemVersionOutputSchema);

/** Is this struct field an OPTIONAL KEY (present-or-absent), as opposed to a
 *  required one or an `undefined`-admitting `Schema.optional`? */
const isOptionalKey = (field: { readonly ast: unknown }): boolean =>
  (field.ast as { context?: { isOptional?: boolean } }).context?.isOptional ===
  true;

describe("system.version shape — frozen for existing consumers", () => {
  it("SystemVersionOutputSchema is exactly { contractVersion, identity?, lifetime?, pid, startedAt }", () => {
    expect(Object.keys(SystemVersionOutputSchema.fields).sort()).toEqual([
      "contractVersion",
      "identity",
      "lifetime",
      "pid",
      "startedAt",
    ]);
  });

  it("PtyHostIdentitySchema (the currency identity) is exactly { navigableCommit, staleKey }", () => {
    expect(Object.keys(PtyHostIdentitySchema.fields).sort()).toEqual([
      "navigableCommit",
      "staleKey",
    ]);
  });

  it("identity stays OPTIONAL — a daemon predating the field still handshakes", () => {
    expect(isOptionalKey(SystemVersionOutputSchema.fields.identity)).toBe(true);
  });

  it("lifetime is OPTIONAL — a daemon predating the lifetime field still handshakes; the reader falls back to '—'", () => {
    expect(isOptionalKey(SystemVersionOutputSchema.fields.lifetime)).toBe(true);
  });

  it("parses a handshake predating the lifetime field (no `lifetime` key → undefined), and round-trips one that carries it — the survivor stays compatible with NO contract bump", () => {
    // A pre-field survivor's `system.version` carries no `lifetime` key at all.
    // It must parse (optional, additive — no PTY_HOST_CONTRACT_VERSION bump),
    // leaving `lifetime` undefined so the reader falls back to "—" rather than
    // the parse rejecting the survivor and forcing a recycle.
    const survivor = decode({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
    });
    expect(survivor.lifetime).toBeUndefined();

    // A live daemon carries the projected lifetime; it survives the parse verbatim.
    const live = decode({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
  });

  // ── Byte fixtures (PLAN #17) ────────────────────────────────────────────
  //
  // What another build reads off this handshake is the encoded JSON STRING, not
  // a decoded object, so these pins are literal bytes. They are what licenses
  // the claim in `PTY_HOST_CONTRACT_VERSION`'s note that the 7.0 epoch break
  // moved the FRAMING and not these payloads.

  it("encodes the full handshake byte-for-byte as the zod schema did", () => {
    expect(
      JSON.stringify(
        encode({
          contractVersion: "7.0",
          pid: 1234,
          startedAt: 1000,
          identity: { staleKey: "abc", navigableCommit: "deadbeef" },
          lifetime: { kind: "boundToPid", pid: 4321 },
        }),
      ),
    ).toBe(
      '{"contractVersion":"7.0","pid":1234,"startedAt":1000,"identity":{"staleKey":"abc","navigableCommit":"deadbeef"},"lifetime":{"kind":"boundToPid","pid":4321}}',
    );
  });

  it("OMITS an absent optional key rather than encoding it as null (`optionalKey`, not `optional`)", () => {
    // The whole reason #17 makes `optionalKey` the law. A `null` here would be a
    // fourth state — neither absent, nor a real identity — that every reader of
    // this handshake would have to grow an arm for.
    expect(
      JSON.stringify(
        encode({ contractVersion: "7.0", pid: 1234, startedAt: 1000 }),
      ),
    ).toBe('{"contractVersion":"7.0","pid":1234,"startedAt":1000}');
  });

  it("encodes the `forever` lifetime as the bare discriminant, on `kind` (never `_tag`)", () => {
    // A `Schema.Union` of structs, not a `Schema.TaggedUnion`: the discriminant
    // is this wire's own `kind`. Renaming it to Effect's `_tag` convention would
    // break every consumer's reducer while every decode-equality test stayed
    // green — which is why this one asserts the string.
    expect(
      JSON.stringify(
        encode({
          contractVersion: "7.0",
          pid: 1,
          startedAt: 2,
          lifetime: { kind: "forever" },
        }),
      ),
    ).toBe(
      '{"contractVersion":"7.0","pid":1,"startedAt":2,"lifetime":{"kind":"forever"}}',
    );
  });
});
