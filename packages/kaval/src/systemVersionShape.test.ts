import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PtyHostIdentitySchema,
  SystemVersionOutputSchema,
} from "./ptyHostSurface.ts";

const decode = Schema.decodeUnknownSync(SystemVersionOutputSchema);
const encode = Schema.encodeUnknownSync(SystemVersionOutputSchema);

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
    const survivor = decode({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
    });
    expect(survivor.lifetime).toBeUndefined();

    const live = decode({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
  });

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
    expect(
      JSON.stringify(
        encode({ contractVersion: "7.0", pid: 1234, startedAt: 1000 }),
      ),
    ).toBe('{"contractVersion":"7.0","pid":1234,"startedAt":1000}');
  });

  it("encodes the `forever` lifetime as the bare discriminant, on `kind` (never `_tag`)", () => {
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
