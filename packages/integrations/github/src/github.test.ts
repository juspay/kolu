import { describe, expect, it } from "vitest";
import {
  classifyGhError,
  deriveCheckStatus,
  GH_PR_VIEW_JSON_FIELDS,
  type GhPrViewJson,
  prInfoFromGhView,
} from "./github.ts";

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
  ])("completed CheckRun $conclusion → $expected", ({
    conclusion,
    expected,
  }) => {
    expect(deriveCheckStatus([{ status: "COMPLETED", conclusion }])).toBe(
      expected,
    );
  });

  it.each([
    "QUEUED",
    "IN_PROGRESS",
    "WAITING",
    "PENDING",
    "REQUESTED",
  ])("non-terminal CheckRun %s → pending", (status) => {
    expect(deriveCheckStatus([{ status }])).toBe("pending");
  });

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

  it.each([
    {
      label: "gh's 'no pull requests found'",
      stderr: 'no pull requests found for branch "my-branch"',
    },
    {
      label: "gh's 'no git remotes found'",
      stderr: "no git remotes found\n",
    },
    {
      label: "a non-GitHub remote (gh's 'none of the git remotes' refusal)",
      stderr:
        "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`",
    },
  ])("classifies $label as absent", ({ stderr }) => {
    expect(classifyGhError({ code: 1, stderr })).toEqual({ kind: "absent" });
  });

  it("keeps gh's GH_HOST-mismatch refusal as unavailable, not absent", () => {
    // Same "none of the git remotes" prefix, but a real config failure: a
    // GH_HOST is set that matches none of the remotes. The user should see
    // this, not have it silently swallowed as "no PR on this branch".
    expect(
      classifyGhError({
        code: 1,
        stderr:
          "none of the git remotes configured for this repository correspond to the GH_HOST environment variable. Try adding a matching remote or unsetting the variable",
      }),
    ).toEqual({
      kind: "unavailable",
      source: { provider: "gh", code: "unknown" },
    });
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

describe("prInfoFromGhView", () => {
  const base: GhPrViewJson = {
    number: 42,
    title: "Keep coverage",
    url: "https://github.test/pull/42",
    state: "OPEN",
    statusCheckRollup: undefined,
    reviewDecision: null,
    mergeStateStatus: "UNKNOWN",
  };

  it("asks gh for reviewDecision and mergeStateStatus on the same view call", () => {
    const fields = GH_PR_VIEW_JSON_FIELDS.split(",");
    expect(fields).toContain("reviewDecision");
    expect(fields).toContain("mergeStateStatus");
    expect(fields).toContain("statusCheckRollup");
  });

  it("carries gh's reviewDecision and mergeStateStatus verbatim", () => {
    expect(
      prInfoFromGhView({
        ...base,
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN",
      }),
    ).toEqual({
      number: 42,
      title: "Keep coverage",
      url: "https://github.test/pull/42",
      state: "open",
      checks: null,
      checkRuns: [],
      reviewDecision: "APPROVED",
      mergeStateStatus: "CLEAN",
    });
  });

  it.each([
    "APPROVED",
    "CHANGES_REQUESTED",
    "REVIEW_REQUIRED",
    null,
  ] as const)("passes reviewDecision %s through", (reviewDecision) => {
    expect(prInfoFromGhView({ ...base, reviewDecision }).reviewDecision).toBe(
      reviewDecision,
    );
  });

  it.each([
    "BEHIND",
    "BLOCKED",
    "CLEAN",
    "DIRTY",
    "DRAFT",
    "HAS_HOOKS",
    "UNKNOWN",
    "UNSTABLE",
  ] as const)("passes mergeStateStatus %s through", (mergeStateStatus) => {
    expect(
      prInfoFromGhView({ ...base, mergeStateStatus }).mergeStateStatus,
    ).toBe(mergeStateStatus);
  });

  it("rejects a friendlier reviewDecision rather than mapping it", () => {
    expect(() =>
      prInfoFromGhView({ ...base, reviewDecision: "approved" }),
    ).toThrow();
  });

  it("rejects a friendlier mergeStateStatus rather than mapping it", () => {
    expect(() =>
      prInfoFromGhView({ ...base, mergeStateStatus: "clean" }),
    ).toThrow();
  });

  it("throws when a requested field is missing from gh's JSON", () => {
    const { mergeStateStatus: _dropped, ...rest } = base;
    expect(() => prInfoFromGhView(rest as GhPrViewJson)).toThrow();
  });
});
