import { describe, expect, it } from "vitest";
import { prResultEqual } from "./schemas.ts";
import type { PrInfo, PrResult } from "./schemas.ts";

describe("prResultEqual", () => {
  const pr: PrInfo = {
    number: 1,
    title: "test",
    url: "https://github.com/test/test/pull/1",
    state: "open",
    checks: "pass",
    checkRuns: [],
  };
  const ok: PrResult = { kind: "ok", value: pr };

  it("returns true for identical references", () => {
    expect(prResultEqual(ok, ok)).toBe(true);
  });

  it("returns true for both pending", () => {
    expect(prResultEqual({ kind: "pending" }, { kind: "pending" })).toBe(true);
  });

  it("returns true for both absent", () => {
    expect(prResultEqual({ kind: "absent" }, { kind: "absent" })).toBe(true);
  });

  it("returns false when kinds differ", () => {
    expect(prResultEqual(ok, { kind: "absent" })).toBe(false);
    expect(prResultEqual({ kind: "pending" }, { kind: "absent" })).toBe(false);
  });

  it("returns true for equal ok values", () => {
    expect(prResultEqual(ok, { kind: "ok", value: { ...pr } })).toBe(true);
  });

  it.each([
    { field: "number", value: 2 },
    { field: "title", value: "other" },
    { field: "state", value: "merged" },
    { field: "checks", value: "fail" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(
      prResultEqual(ok, { kind: "ok", value: { ...pr, [field]: value } }),
    ).toBe(false);
  });

  it("compares unavailable by tagged source (provider + code)", () => {
    const a: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-installed" },
    };
    const b: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-installed" },
    };
    const c: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-authenticated" },
    };
    expect(prResultEqual(a, b)).toBe(true);
    expect(prResultEqual(a, c)).toBe(false);
  });
});
