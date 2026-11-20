import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeHostKey,
  decodeHostKeyValue,
  encodeHostKey,
  type HostKey,
  HostKeySchema,
  hostKeysEqual,
  LOCAL_HOST,
  parseHostInput,
  PersistedHostsSchema,
} from "./hostKey.ts";

const accepts =
  <T, E>(schema: Schema.Codec<T, E>) =>
  (value: unknown): boolean =>
    Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

const rejectionMessage = <T, E>(
  schema: Schema.Codec<T, E>,
  value: unknown,
): string => {
  const result = Schema.decodeUnknownResult(schema)(value);
  if (Result.isSuccess(result)) throw new Error("expected a decode failure");
  return String(result.failure);
};

const acceptsHostKey = accepts(HostKeySchema);
const acceptsPersistedHosts = accepts(PersistedHostsSchema);

describe("HostKey — a discriminated sum, not an in-band string sentinel", () => {
  it("HostKeySchema accepts the local + remote shapes and rejects an empty remote target", () => {
    expect(acceptsHostKey({ kind: "local" })).toBe(true);
    expect(acceptsHostKey({ kind: "remote", target: "srid@zest" })).toBe(true);
    expect(acceptsHostKey({ kind: "remote", target: "" })).toBe(false);
    expect(acceptsHostKey("local")).toBe(false);
  });

  it("LOCAL_HOST is the local variant", () => {
    expect(LOCAL_HOST).toEqual({ kind: "local" });
  });

  it("decodeHostKeyValue is the ONE re-validation entry, and it THROWS", () => {
    expect(decodeHostKeyValue({ kind: "local" })).toEqual(LOCAL_HOST);
    expect(decodeHostKeyValue({ kind: "remote", target: "zest" })).toEqual({
      kind: "remote",
      target: "zest",
    });
    expect(() => decodeHostKeyValue({ kind: "remote", target: "" })).toThrow();
    expect(() => decodeHostKeyValue("local")).toThrow();
  });

  it("encodes to the SAME wire bytes the sum decodes from", () => {
    const encode = Schema.encodeSync(HostKeySchema);
    expect(JSON.stringify(encode(LOCAL_HOST))).toBe('{"kind":"local"}');
    expect(
      JSON.stringify(encode({ kind: "remote", target: "srid@zest" })),
    ).toBe('{"kind":"remote","target":"srid@zest"}');
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
    expect(acceptsHostKey({ kind: "remote", target: "" })).toBe(false);
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

  it("keeps the persisted STRING form byte-identical for every spelling", () => {
    const cases: ReadonlyArray<readonly [HostKey, string]> = [
      [LOCAL_HOST, "local"],
      [{ kind: "remote", target: "zest" }, "remote:zest"],
      [{ kind: "remote", target: "srid@zest" }, "remote:srid@zest"],
      [{ kind: "remote", target: "remote:zest" }, "remote:remote:zest"],
      [{ kind: "remote", target: "127.0.0.1" }, "remote:127.0.0.1"],
    ];
    for (const [key, wire] of cases) {
      expect(encodeHostKey(key)).toBe(wire);
      expect(decodeHostKey(wire)).toEqual(key);
    }
  });
});

describe("PersistedHostsSchema — the conf store's `hosts` field", () => {
  it("decodes a well-formed list to the same strings, and encodes them back byte-identically", () => {
    const stored = '["remote:srid@zest","remote:pu-dev"]';
    const decoded = Schema.decodeUnknownSync(PersistedHostsSchema)(
      JSON.parse(stored),
    );
    expect(decoded).toEqual(["remote:srid@zest", "remote:pu-dev"]);
    expect(
      JSON.stringify(Schema.encodeSync(PersistedHostsSchema)(decoded)),
    ).toBe(stored);
  });

  it("accepts the empty list (a fresh install remembers no guest hosts)", () => {
    expect(acceptsPersistedHosts([])).toBe(true);
    expect(JSON.stringify(Schema.encodeSync(PersistedHostsSchema)([]))).toBe(
      "[]",
    );
  });

  it("REJECTS a non-canonical element — never normalizes it away", () => {
    expect(acceptsPersistedHosts(["zest"])).toBe(false);
    expect(acceptsPersistedHosts(["remote:"])).toBe(false);
    expect(acceptsPersistedHosts([{ kind: "remote", target: "zest" }])).toBe(
      false,
    );
    expect(rejectionMessage(PersistedHostsSchema, ["zest"])).toContain(
      "not a canonical encoded host key",
    );
  });

  it("REJECTS the local default — it is code-seeded, never persisted", () => {
    expect(acceptsPersistedHosts(["local"])).toBe(false);
    expect(acceptsPersistedHosts(["remote:zest", "local"])).toBe(false);
    expect(rejectionMessage(PersistedHostsSchema, ["local"])).toContain(
      'the local default ("local") must never be persisted',
    );
  });

  it("REJECTS duplicates", () => {
    expect(acceptsPersistedHosts(["remote:zest", "remote:zest"])).toBe(false);
    expect(
      rejectionMessage(PersistedHostsSchema, ["remote:zest", "remote:zest"]),
    ).toContain("duplicate host entries");
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
