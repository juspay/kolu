import type {
  GitChangedFile,
  GitStatusOutput,
} from "@kolu/terminal-workspace/surface";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { describe, expect, it } from "vitest";
import type { FieldTone } from "./render.ts";
import {
  branchFromAwareness,
  formatGitStatusJson,
  projectGitStatus,
  statusGlyph,
} from "./gitStatusRender.ts";

const id = (s: string): TerminalId => s as TerminalId;

function file(
  path: string,
  status: GitChangedFile["status"],
  oldPath?: string,
): GitChangedFile {
  return { path, status, ...(oldPath !== undefined && { oldPath }) };
}

function status(
  files: GitChangedFile[],
  base: GitStatusOutput["base"] = null,
): GitStatusOutput {
  return { files, base };
}

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

describe("statusGlyph", () => {
  it("returns the raw status code verbatim", () => {
    expect(statusGlyph("A")).toBe("A");
    expect(statusGlyph("M")).toBe("M");
    expect(statusGlyph("?")).toBe("?");
    expect(statusGlyph("D")).toBe("D");
    expect(statusGlyph("R")).toBe("R");
  });
});

describe("branchFromAwareness", () => {
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

describe("projectGitStatus", () => {
  it("groups files into staged, modified, untracked in display order", () => {
    const view = projectGitStatus(
      status([
        file("src/new.ts", "A"),
        file("src/modified.ts", "M"),
        file("src/untracked.ts", "?"),
        file("src/deleted.ts", "D"),
      ]),
      null,
      "feat/x",
      "/home/srid/code/kolu",
      0,
      null,
    );
    expect(view.repoName).toBe("kolu");
    expect(view.branch).toBe("feat/x");
    expect(view.seq).toBe(0);
    expect(view.error).toBeNull();

    const names = view.sections.map((s) => s.name);
    expect(names).toEqual(["staged", "modified", "untracked"]);

    const staged = view.sections.find((s) => s.name === "staged");
    expect(staged?.files).toHaveLength(1);
    expect(staged?.files[0]?.path).toBe("src/new.ts");

    const modified = view.sections.find((s) => s.name === "modified");
    expect(modified?.files).toHaveLength(2);
    expect(modified?.files.map((f) => f.path)).toEqual([
      "src/deleted.ts",
      "src/modified.ts",
    ]);

    const untracked = view.sections.find((s) => s.name === "untracked");
    expect(untracked?.files).toHaveLength(1);
    expect(untracked?.files[0]?.path).toBe("src/untracked.ts");
  });

  it("omits empty groups", () => {
    const view = projectGitStatus(
      status([file("a.ts", "M")]),
      null,
      null,
      "/repo",
      5,
      null,
    );
    expect(view.sections.map((s) => s.name)).toEqual(["modified"]);
  });

  it("shows no sections when the status is null (not yet queried)", () => {
    const view = projectGitStatus(null, null, null, "/repo", 0, null);
    expect(view.sections).toEqual([]);
    expect(view.branchComparison).toBeNull();
  });

  it("surfaces an error without collapsing to empty", () => {
    const view = projectGitStatus(
      null,
      null,
      null,
      "/repo",
      3,
      "GIT_FAILED: not a repo",
    );
    expect(view.error).toBe("GIT_FAILED: not a repo");
    expect(view.sections).toEqual([]);
  });

  it("derives the branch comparison from branch-mode status", () => {
    const branchStatus: GitStatusOutput = {
      files: [file("a.ts", "M"), file("b.ts", "A")],
      base: { ref: "origin/master", sha: "abc123" },
    };
    const view = projectGitStatus(
      status([file("a.ts", "M")]),
      branchStatus,
      "feat/x",
      "/repo",
      2,
      null,
    );
    expect(view.branchComparison).toEqual({
      ref: "origin/master",
      fileCount: 2,
    });
  });

  it("returns null branch comparison when branch mode has no base", () => {
    const view = projectGitStatus(
      status([file("a.ts", "M")]),
      status([], null),
      "main",
      "/repo",
      1,
      null,
    );
    expect(view.branchComparison).toBeNull();
  });

  it("assigns tones: staged → pass, modified → plain, untracked → pending", () => {
    const view = projectGitStatus(
      status([file("a.ts", "A"), file("b.ts", "M"), file("c.ts", "?")]),
      null,
      null,
      "/repo",
      0,
      null,
    );
    const toneFor = (name: string): FieldTone | undefined =>
      view.sections.find((s) => s.name === name)?.tone;
    expect(toneFor("staged")).toBe("pass");
    expect(toneFor("modified")).toBe("plain");
    expect(toneFor("untracked")).toBe("pending");
  });

  it("derives repo name from the path's last component", () => {
    const view = projectGitStatus(
      status([]),
      null,
      null,
      "/home/srid/code/kolu/",
      0,
      null,
    );
    expect(view.repoName).toBe("kolu");
  });
});

describe("formatGitStatusJson", () => {
  it("emits the repo path, branch, and both status modes", () => {
    const out = formatGitStatusJson({
      repoPath: "/repo",
      branch: "feat/x",
      status: status([file("a.ts", "M")]),
      branchStatus: status([file("a.ts", "M")], {
        ref: "origin/master",
        sha: "abc",
      }),
    });
    const parsed = JSON.parse(out);
    expect(parsed.repoPath).toBe("/repo");
    expect(parsed.branch).toBe("feat/x");
    expect(parsed.local.files).toHaveLength(1);
    expect(parsed.branchMode.base?.ref).toBe("origin/master");
  });

  it("honest nulls when the query failed or branch is unknown", () => {
    const out = formatGitStatusJson({
      repoPath: "/repo",
      branch: null,
      status: null,
      branchStatus: null,
    });
    const parsed = JSON.parse(out);
    expect(parsed.branch).toBeNull();
    expect(parsed.local).toBeNull();
    expect(parsed.branchMode).toBeNull();
  });
});
