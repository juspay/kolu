import { describe, expect, it } from "vitest";
import { mergeGitStatusEntries } from "./gitStatusEntries";

describe("mergeGitStatusEntries", () => {
  it("returns nothing for two empty layers", () => {
    expect(mergeGitStatusEntries([], [])).toEqual([]);
  });

  it("maps single-letter status to Pierre's word form", () => {
    expect(mergeGitStatusEntries([{ path: "a", status: "M" }], [])).toEqual([
      { path: "a", status: "modified" },
    ]);
    expect(mergeGitStatusEntries([], [{ path: "b", status: "?" }])).toEqual([
      { path: "b", status: "untracked" },
    ]);
  });

  it("keeps a fallback-only (branch) path with its own word", () => {
    // Committed earlier in the branch, clean locally: present only in the
    // branch layer, so it surfaces with the branch word.
    expect(mergeGitStatusEntries([], [{ path: "b", status: "M" }])).toEqual([
      { path: "b", status: "modified" },
    ]);
  });

  it("keeps a primary-only (local) path", () => {
    expect(mergeGitStatusEntries([{ path: "a", status: "?" }], [])).toEqual([
      { path: "a", status: "untracked" },
    ]);
  });

  it("lets primary (local) win over fallback (branch) on a shared path", () => {
    // Same file in both layers with different statuses — local wins.
    const merged = mergeGitStatusEntries(
      [{ path: "x", status: "?" }],
      [{ path: "x", status: "M" }],
    );
    expect(merged).toEqual([{ path: "x", status: "untracked" }]);
  });

  it("unions disjoint paths across both layers", () => {
    const merged = mergeGitStatusEntries(
      [{ path: "local-only", status: "M" }],
      [{ path: "branch-only", status: "A" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ path: "local-only", status: "modified" });
    expect(merged).toContainEqual({ path: "branch-only", status: "added" });
  });
});
