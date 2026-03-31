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

  it("detects different repoRoot", () => {
    expect(gitInfoEqual(info, { ...info, repoRoot: "/other" })).toBe(false);
  });

  it("detects different branch", () => {
    expect(gitInfoEqual(info, { ...info, branch: "develop" })).toBe(false);
  });

  it("detects different worktreePath", () => {
    expect(gitInfoEqual(info, { ...info, worktreePath: "/other" })).toBe(false);
  });

  it("ignores repoName differences (not compared)", () => {
    expect(gitInfoEqual(info, { ...info, repoName: "other" })).toBe(true);
  });

  it("ignores isWorktree differences (not compared)", () => {
    expect(gitInfoEqual(info, { ...info, isWorktree: true })).toBe(true);
  });
});
