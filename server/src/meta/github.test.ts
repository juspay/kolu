import { describe, it, expect } from "vitest";
import { deriveCheckStatus, prInfoEqual } from "./github.ts";
import type { GitHubPrInfo } from "kolu-common";

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

describe("prInfoEqual", () => {
  const pr: GitHubPrInfo = {
    number: 1,
    title: "test",
    url: "https://github.com/test/test/pull/1",
    state: "open",
    checks: "pass",
  };

  it("returns true for identical references", () => {
    expect(prInfoEqual(pr, pr)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(prInfoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(prInfoEqual(pr, null)).toBe(false);
    expect(prInfoEqual(null, pr)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(prInfoEqual(pr, { ...pr })).toBe(true);
  });

  it.each([
    { field: "number", value: 2 },
    { field: "title", value: "other" },
    { field: "state", value: "merged" },
    { field: "checks", value: "fail" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(prInfoEqual(pr, { ...pr, [field]: value })).toBe(false);
  });
});
