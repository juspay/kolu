import { describe, it, expect } from "vitest";
import { gitInfoEqual } from "./git.ts";
import type { GitInfo } from "kolu-common";

describe("gitInfoEqual", () => {
  const info: GitInfo = {
    repoRoot: "/home/user/repo",
    repoName: "repo",
    worktreePath: "/home/user/repo",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/repo",
  };

  it("returns true for identical references", () => {
    expect(gitInfoEqual(info, info)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(gitInfoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(gitInfoEqual(info, null)).toBe(false);
    expect(gitInfoEqual(null, info)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(gitInfoEqual(info, { ...info })).toBe(true);
  });

  // Fields that ARE compared
  it.each([
    { field: "repoRoot", value: "/other" },
    { field: "branch", value: "develop" },
    { field: "worktreePath", value: "/other" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(false);
  });

  // Fields that are NOT compared (intentional — only identity-level fields matter)
  it.each([
    { field: "repoName", value: "other" },
    { field: "isWorktree", value: true },
  ] as const)("ignores $field differences", ({ field, value }) => {
    expect(gitInfoEqual(info, { ...info, [field]: value })).toBe(true);
  });
});
