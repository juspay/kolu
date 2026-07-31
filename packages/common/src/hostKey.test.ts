import { describe, expect, it } from "vitest";
import {
  decodeHostKey,
  encodeHostKey,
  HostKeySchema,
  hostKeysEqual,
  LOCAL_HOST,
  parseHostInput,
} from "./hostKey.ts";

describe("HostKey — a discriminated sum, not an in-band string sentinel", () => {
  it("HostKeySchema accepts the local + remote shapes and rejects an empty remote target", () => {
    expect(HostKeySchema.safeParse({ kind: "local" }).success).toBe(true);
    expect(
      HostKeySchema.safeParse({ kind: "remote", target: "srid@zest" }).success,
    ).toBe(true);
    expect(
      HostKeySchema.safeParse({ kind: "remote", target: "" }).success,
    ).toBe(false);
    // A bare string is no longer a HostKey at all — the union is nominal on `.kind`.
    expect(HostKeySchema.safeParse("local").success).toBe(false);
  });

  it("LOCAL_HOST is the local variant", () => {
    expect(LOCAL_HOST).toEqual({ kind: "local" });
  });
});

describe("parseHostInput vs decodeHostKey — two boundaries, same string, different meanings", () => {
  it("parseHostInput takes a 'remote:' prefixed HUMAN string LITERALLY", () => {
    expect(parseHostInput("remote:zest")).toEqual({
      kind: "remote",
      target: "remote:zest",
    });
  });

  it("decodeHostKey interprets the SAME string as its own canonical 'remote:' prefix", () => {
    expect(decodeHostKey("remote:zest")).toEqual({
      kind: "remote",
      target: "zest",
    });
  });

  it("parseHostInput('local') is the local variant", () => {
    expect(parseHostInput("local")).toEqual({ kind: "local" });
  });

  it("parseHostInput canonicalizes bare loopback spellings to the local variant (dedupes with 'local')", () => {
    // 'localhost' / '127.0.0.1' / '::1' name the SAME machine `{ kind: "local" }`
    // already names — a `KOLU_PADI_HOST=localhost,srid@zest` seed used to mint a
    // SECOND, ssh-bound pool entry for the loopback (three chips instead of two).
    expect(parseHostInput("localhost")).toEqual({ kind: "local" });
    expect(parseHostInput("127.0.0.1")).toEqual({ kind: "local" });
    expect(parseHostInput("::1")).toEqual({ kind: "local" });
  });

  it("parseHostInput('user@localhost') STAYS remote — ssh as another user is a distinct session", () => {
    expect(parseHostInput("user@localhost")).toEqual({
      kind: "remote",
      target: "user@localhost",
    });
  });

  it("parseHostInput('') THROWS rather than mint an illegal empty-target remote", () => {
    expect(() => parseHostInput("")).toThrow();
    // And the schema agrees: the shape parseHostInput would otherwise have minted is
    // exactly what HostKeySchema rejects (see the schema test above).
    expect(
      HostKeySchema.safeParse({ kind: "remote", target: "" }).success,
    ).toBe(false);
  });
});

describe("encodeHostKey / decodeHostKey — the canonical wire codec round-trips", () => {
  it("round-trips the local variant", () => {
    expect(decodeHostKey(encodeHostKey(LOCAL_HOST))).toEqual(LOCAL_HOST);
    expect(encodeHostKey(LOCAL_HOST)).toBe("local");
  });

  it("round-trips a remote variant", () => {
    const remote = { kind: "remote" as const, target: "srid@zest" };
    expect(encodeHostKey(remote)).toBe("remote:srid@zest");
    expect(decodeHostKey(encodeHostKey(remote))).toEqual(remote);
  });

  it("decodeHostKey THROWS on a non-canonical string", () => {
    expect(() => decodeHostKey("zest")).toThrow();
    expect(() => decodeHostKey("srid@zest")).toThrow();
  });

  it("decodeHostKey rejects a 'remote:' prefix with an empty target", () => {
    expect(() => decodeHostKey("remote:")).toThrow();
  });
});

describe("hostKeysEqual — canonical structured-key equality", () => {
  it.each([
    [LOCAL_HOST, LOCAL_HOST, true],
    [
      { kind: "remote", target: "srid@zest" } as const,
      { kind: "remote", target: "srid@zest" } as const,
      true,
    ],
    [
      { kind: "remote", target: "srid@zest" } as const,
      { kind: "remote", target: "srid@petit" } as const,
      false,
    ],
    [LOCAL_HOST, { kind: "remote", target: "srid@zest" } as const, false],
  ])("compares %o and %o by canonical identity", (left, right, expected) => {
    expect(hostKeysEqual(left, right)).toBe(expected);
  });
});
