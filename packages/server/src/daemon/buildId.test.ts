import { describe, expect, it } from "vitest";
import { deriveBuildId, resolveBuildId } from "./buildId.ts";

describe("deriveBuildId", () => {
  it("extracts the /nix/store hash-name from a stamped entry path", () => {
    expect(
      deriveBuildId(
        "/nix/store/abc123-kolu-stamped/packages/server/src/index.ts",
      ),
    ).toBe("abc123-kolu-stamped");
  });

  it("differs across deploys (different store hash)", () => {
    const a = deriveBuildId(
      "/nix/store/aaa-kolu-stamped/packages/server/src/index.ts",
    );
    const b = deriveBuildId(
      "/nix/store/bbb-kolu-stamped/packages/server/src/index.ts",
    );
    expect(a).not.toBe(b);
  });

  it("falls back to the entry's directory for a dev (non-store) path", () => {
    expect(deriveBuildId("/home/dev/kolu/packages/server/src/index.ts")).toBe(
      "/home/dev/kolu/packages/server/src",
    );
  });

  it("is stable across restarts for the same dev path", () => {
    const p = "/home/dev/kolu/packages/server/src/index.ts";
    expect(deriveBuildId(p)).toBe(deriveBuildId(p));
  });

  it("returns 'unknown' for an empty entry", () => {
    expect(deriveBuildId(undefined)).toBe("unknown");
    expect(deriveBuildId("")).toBe("unknown");
  });
});

describe("resolveBuildId", () => {
  const entry = "/nix/store/zzz-kolu-stamped/packages/server/src/index.ts";

  it("prefers override over the pty-host id and the entry-derived value", () => {
    expect(resolveBuildId({ override: "ovr", ptyHostId: "pty", entry })).toBe(
      "ovr",
    );
  });

  it("prefers the pty-host id over the entry-derived value", () => {
    expect(resolveBuildId({ ptyHostId: "pty", entry })).toBe("pty");
  });

  it("falls back to deriveBuildId(entry) when only entry is set", () => {
    expect(resolveBuildId({ entry })).toBe(deriveBuildId(entry));
  });
});
