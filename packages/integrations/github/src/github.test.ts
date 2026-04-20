import { describe, it, expect } from "vitest";
import { deriveCheckStatus, prResultEqual, classifyGhError } from "./github.ts";
import type { GitHubPrInfo, PrResult } from "./schemas.ts";

describe("deriveCheckStatus", () => {
  it("returns null for undefined rollup", () => {
    expect(deriveCheckStatus(undefined)).toBeNull();
  });

  it("returns null for empty rollup", () => {
    expect(deriveCheckStatus([])).toBeNull();
  });

  it.each([
    { state: "SUCCESS", expected: "pass" },
    { state: "FAILURE", expected: "fail" },
    { state: "ERROR", expected: "fail" },
    { state: "PENDING", expected: "pending" },
    { state: "EXPECTED", expected: "pending" },
  ])("StatusContext $state → $expected", ({ state, expected }) => {
    expect(deriveCheckStatus([{ __typename: "StatusContext", state }])).toBe(
      expected,
    );
  });

  it.each([
    { conclusion: "SUCCESS", expected: "pass" },
    { conclusion: "NEUTRAL", expected: "pass" },
    { conclusion: "SKIPPED", expected: "pass" },
    { conclusion: "FAILURE", expected: "fail" },
    { conclusion: "CANCELLED", expected: "fail" },
    { conclusion: "TIMED_OUT", expected: "fail" },
    { conclusion: "STARTUP_FAILURE", expected: "fail" },
    { conclusion: "ACTION_REQUIRED", expected: "fail" },
    { conclusion: "STALE", expected: "fail" },
  ])(
    "completed CheckRun $conclusion → $expected",
    ({ conclusion, expected }) => {
      expect(deriveCheckStatus([{ status: "COMPLETED", conclusion }])).toBe(
        expected,
      );
    },
  );

  it.each(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"])(
    "non-terminal CheckRun %s → pending",
    (status) => {
      expect(deriveCheckStatus([{ status }])).toBe("pending");
    },
  );

  it("failure takes priority over pending", () => {
    expect(
      deriveCheckStatus([
        { __typename: "StatusContext", state: "PENDING" },
        { __typename: "StatusContext", state: "FAILURE" },
      ]),
    ).toBe("fail");
  });

  it("pending takes priority over pass", () => {
    expect(
      deriveCheckStatus([
        { __typename: "StatusContext", state: "SUCCESS" },
        { status: "IN_PROGRESS" },
      ]),
    ).toBe("pending");
  });

  it("handles case-insensitive state values", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "failure" }]),
    ).toBe("fail");
  });
});

describe("prResultEqual", () => {
  const pr: GitHubPrInfo = {
    number: 1,
    title: "test",
    url: "https://github.com/test/test/pull/1",
    state: "open",
    checks: "pass",
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

describe("classifyGhError", () => {
  it("classifies ENOENT as not installed", () => {
    expect(classifyGhError({ code: "ENOENT" })).toEqual({
      kind: "unavailable",
      source: { provider: "gh", code: "not-installed" },
    });
  });

  it("classifies timeout (killed) as timed out", () => {
    expect(
      classifyGhError({ killed: true, signal: "SIGTERM", code: null }),
    ).toEqual({
      kind: "unavailable",
      source: { provider: "gh", code: "timed-out" },
    });
  });

  it.each([
    "You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
    "error connecting to github.com\nTry authentication with: gh auth login",
    "authentication required",
  ])("classifies auth-failure stderr %# as not authenticated", (stderr) => {
    expect(classifyGhError({ code: 1, stderr })).toEqual({
      kind: "unavailable",
      source: { provider: "gh", code: "not-authenticated" },
    });
  });

  it("classifies gh's 'no pull requests found' as absent", () => {
    expect(
      classifyGhError({
        code: 1,
        stderr: 'no pull requests found for branch "my-branch"',
      }),
    ).toEqual({ kind: "absent" });
  });

  it.each([
    { input: new Error("JSON parse boom"), label: "Error instance" },
    { input: "raw string", label: "raw string" },
    {
      input: { code: 1, stderr: "unexpected runtime error from gh" },
      label: "unrecognized stderr",
    },
  ])("flags unrecognized $label as unavailable", ({ input }) => {
    expect(classifyGhError(input)).toEqual({
      kind: "unavailable",
      source: { provider: "gh", code: "unknown" },
    });
  });
});
