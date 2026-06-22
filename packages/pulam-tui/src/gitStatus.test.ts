import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { describe, expect, it } from "vitest";
import { branchFromAwareness } from "./gitStatus.ts";

const id = (s: string): TerminalId => s as TerminalId;

function val(git: AwarenessValue["git"]): AwarenessValue {
  return {
    cwd: "/repo",
    git,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  } as AwarenessValue;
}

const git = (repoRoot: string, branch: string): AwarenessValue["git"] =>
  ({
    repoRoot,
    repoName: "x",
    worktreePath: repoRoot,
    branch,
    isWorktree: false,
    mainRepoRoot: repoRoot,
    remoteUrl: null,
  }) as AwarenessValue["git"];

describe("branchFromAwareness", () => {
  it("finds the branch when a terminal's repoRoot matches", () => {
    const entries: Array<[string, AwarenessValue]> = [
      [id("a"), val(git("/home/srid/code/kolu", "feat/x"))],
    ];
    expect(branchFromAwareness(entries, "/home/srid/code/kolu")).toBe("feat/x");
  });

  it("matches a worktreePath too", () => {
    const entries: Array<[string, AwarenessValue]> = [
      [
        id("a"),
        val({
          ...git("/home/srid/code/kolu", "main"),
          worktreePath: "/home/srid/code/kolu/.worktrees/feat",
        } as AwarenessValue["git"]),
      ],
    ];
    expect(
      branchFromAwareness(entries, "/home/srid/code/kolu/.worktrees/feat"),
    ).toBe("main");
  });

  it("normalizes trailing slashes on both sides", () => {
    const entries: Array<[string, AwarenessValue]> = [
      [id("a"), val(git("/repo/", "dev"))],
    ];
    expect(branchFromAwareness(entries, "/repo")).toBe("dev");
    expect(branchFromAwareness(entries, "/repo/")).toBe("dev");
  });

  it("returns null when no terminal is in that repo", () => {
    const entries: Array<[string, AwarenessValue]> = [
      [id("a"), val(git("/other", "main"))],
    ];
    expect(branchFromAwareness(entries, "/repo")).toBeNull();
  });

  it("returns null when the matching terminal has no git info", () => {
    const entries: Array<[string, AwarenessValue]> = [[id("a"), val(null)]];
    expect(branchFromAwareness(entries, "/repo")).toBeNull();
  });
});
