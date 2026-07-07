import { COLLECTION_RESERVED_CHANNEL_SUFFIXES } from "@kolu/surface/channel-names";
import { describe, expect, it } from "vitest";
import { HostKeySchema, LOCAL_HOST } from "./hostKey.ts";

describe("HostKeySchema — the branded host-key producer", () => {
  it("REJECTS a key equal to a reserved collection channel suffix (RS4 #5)", () => {
    // A host key of "keys" would make the `entries` membership collection's
    // per-key channel `entries:keys` alias its reserved keyset channel and
    // cross-wire the streams — the sole producer refuses it, sealing every path.
    for (const reserved of COLLECTION_RESERVED_CHANNEL_SUFFIXES) {
      const parsed = HostKeySchema.safeParse(reserved);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toMatch(/reserved|channel/i);
      }
    }
    // "keys" and "deltas" are the concrete reserved names.
    expect(HostKeySchema.safeParse("keys").success).toBe(false);
    expect(HostKeySchema.safeParse("deltas").success).toBe(false);
    // A hard throw at the throwing `.parse`, too.
    expect(() => HostKeySchema.parse("keys")).toThrow();
  });

  it("accepts every legitimate host key", () => {
    expect(HostKeySchema.safeParse("local").success).toBe(true);
    expect(HostKeySchema.safeParse("srid@zest").success).toBe(true);
    expect(
      HostKeySchema.safeParse("nix-infra@rasam.tail12b27.ts.net").success,
    ).toBe(true);
    // The unremovable default still mints cleanly.
    expect(LOCAL_HOST).toBe("local");
  });
});
