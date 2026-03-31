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

  // StatusContext cases
  it("returns pass for StatusContext SUCCESS", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "SUCCESS" }]),
    ).toBe("pass");
  });

  it("returns fail for StatusContext FAILURE", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "FAILURE" }]),
    ).toBe("fail");
  });

  it("returns fail for StatusContext ERROR", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "ERROR" }]),
    ).toBe("fail");
  });

  it("returns pending for StatusContext PENDING", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "PENDING" }]),
    ).toBe("pending");
  });

  it("returns pending for StatusContext EXPECTED", () => {
    expect(
      deriveCheckStatus([{ __typename: "StatusContext", state: "EXPECTED" }]),
    ).toBe("pending");
  });

  // CheckRun cases
  it("returns pass for completed CheckRun with SUCCESS", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "SUCCESS" }]),
    ).toBe("pass");
  });

  it("returns pass for completed CheckRun with NEUTRAL", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "NEUTRAL" }]),
    ).toBe("pass");
  });

  it("returns pass for completed CheckRun with SKIPPED", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "SKIPPED" }]),
    ).toBe("pass");
  });

  it("returns fail for completed CheckRun with FAILURE", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "FAILURE" }]),
    ).toBe("fail");
  });

  it("returns fail for completed CheckRun with CANCELLED", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "CANCELLED" }]),
    ).toBe("fail");
  });

  it("returns fail for completed CheckRun with TIMED_OUT", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "TIMED_OUT" }]),
    ).toBe("fail");
  });

  it("returns fail for completed CheckRun with STARTUP_FAILURE", () => {
    expect(
      deriveCheckStatus([
        { status: "COMPLETED", conclusion: "STARTUP_FAILURE" },
      ]),
    ).toBe("fail");
  });

  it("returns fail for completed CheckRun with ACTION_REQUIRED", () => {
    expect(
      deriveCheckStatus([
        { status: "COMPLETED", conclusion: "ACTION_REQUIRED" },
      ]),
    ).toBe("fail");
  });

  it("returns fail for completed CheckRun with STALE", () => {
    expect(
      deriveCheckStatus([{ status: "COMPLETED", conclusion: "STALE" }]),
    ).toBe("fail");
  });

  it("returns pending for non-terminal CheckRun statuses", () => {
    for (const status of [
      "QUEUED",
      "IN_PROGRESS",
      "WAITING",
      "PENDING",
      "REQUESTED",
    ]) {
      expect(deriveCheckStatus([{ status }])).toBe("pending");
    }
  });

  // Mixed rollups
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

  it("detects different number", () => {
    expect(prInfoEqual(pr, { ...pr, number: 2 })).toBe(false);
  });

  it("detects different title", () => {
    expect(prInfoEqual(pr, { ...pr, title: "other" })).toBe(false);
  });

  it("detects different state", () => {
    expect(prInfoEqual(pr, { ...pr, state: "merged" })).toBe(false);
  });

  it("detects different checks", () => {
    expect(prInfoEqual(pr, { ...pr, checks: "fail" })).toBe(false);
  });
});
