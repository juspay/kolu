/**
 * `parseKoluPadiHostSeed` — `KOLU_PADI_HOST` as a comma-separated pool SEED list
 * (W4 "the switch"). LOCAL_HOST is always the implicit unremovable default; env
 * unset → exactly one member (pixel-identical single-host). Plus the
 * `UnremovableHostError` the remove path rejects the default with.
 */

import { HostKeySchema, LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import {
  assertRemovableHost,
  isMultiHost,
  KOLU_PADI_HOST_ENV,
  parseKoluPadiHostSeed,
  UnremovableHostError,
} from "./remotePadiBinding.ts";

function withEnv(val: string | undefined, fn: () => void): void {
  const prev = process.env[KOLU_PADI_HOST_ENV];
  if (val === undefined) delete process.env[KOLU_PADI_HOST_ENV];
  else process.env[KOLU_PADI_HOST_ENV] = val;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[KOLU_PADI_HOST_ENV];
    else process.env[KOLU_PADI_HOST_ENV] = prev;
  }
}

describe("parseKoluPadiHostSeed", () => {
  it("unset → [LOCAL_HOST] — a valid 1-member map (pixel-identical single-host)", () => {
    withEnv(undefined, () => {
      expect(parseKoluPadiHostSeed().map(String)).toEqual(["local"]);
      expect(isMultiHost()).toBe(false);
    });
  });

  it("blank/whitespace env → local only", () => {
    withEnv("   ", () => {
      expect(parseKoluPadiHostSeed().map(String)).toEqual(["local"]);
      expect(isMultiHost()).toBe(false);
    });
  });

  it("comma list → local default THEN ordered remotes, deduped, blanks dropped", () => {
    withEnv("srid@zest, srid@yast , ,srid@zest", () => {
      expect(parseKoluPadiHostSeed().map(String)).toEqual([
        "local",
        "srid@zest",
        "srid@yast",
      ]);
      expect(isMultiHost()).toBe(true);
    });
  });

  it("the local default listed explicitly is not doubled", () => {
    withEnv("local,srid@zest", () => {
      const seed = parseKoluPadiHostSeed().map(String);
      expect(seed.filter((h) => h === "local")).toHaveLength(1);
      expect(seed).toEqual(["local", "srid@zest"]);
    });
  });

  it("every entry is a branded HostKey (LOCAL_HOST included)", () => {
    withEnv("srid@zest", () => {
      const seed = parseKoluPadiHostSeed();
      expect(seed[0]).toBe(LOCAL_HOST); // the branded local default, by value
      expect(seed).toHaveLength(2);
    });
  });
});

describe("UnremovableHostError", () => {
  it("is a named Error carrying the host + reason", () => {
    const e = new UnremovableHostError(
      "local",
      "the unremovable local default",
    );
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("UnremovableHostError");
    expect(e.message).toMatch(/cannot remove host "local": /);
  });
});

describe("assertRemovableHost — the remove-path guard", () => {
  const zest = HostKeySchema.parse("srid@zest");
  const yast = HostKeySchema.parse("srid@yast");

  it("throws for LOCAL_HOST — the implicit unremovable member", () => {
    expect(() => assertRemovableHost(LOCAL_HOST, LOCAL_HOST)).toThrow(
      UnremovableHostError,
    );
  });

  it("throws for the boot default host (guard is defaultHost-parameterized)", () => {
    // defaultHost is LOCAL_HOST today, but the guard rejects whatever the boot default
    // is — so a future non-local default is protected by the same LOUD rejection.
    expect(() => assertRemovableHost(zest, zest)).toThrow(UnremovableHostError);
  });

  it("does NOT throw for a guest host (removable)", () => {
    expect(() => assertRemovableHost(zest, LOCAL_HOST)).not.toThrow();
    expect(() => assertRemovableHost(yast, zest)).not.toThrow();
  });
});
