/** The canonical `(group, label)` projection and the two path helpers it is
 *  built from.
 *
 *  Lives beside the projection rather than in whichever app happens to read it
 *  — these cases moved here from `kolu-client/src/path.test.ts` with the code,
 *  because "one projection" is only true if the thing pinning it is in the same
 *  package as the thing it pins. */

import { describe, expect, it } from "vitest";
import {
  cwdBasename,
  shortenCwd,
  terminalCaption,
  terminalKey,
} from "./terminalKey.ts";

/** A worktree at `path` on `branch`. The projection reads two fields; the rest
 *  are here because `GitInfo` is the wire shape every caller actually holds. */
const git = (path: string, repoName: string, branch: string) => ({
  repoRoot: path,
  repoName,
  worktreePath: path,
  branch,
  isWorktree: false,
  mainRepoRoot: path,
  remoteUrl: null,
});

describe("shortenCwd", () => {
  it.each([
    { input: "/home/alice/projects", expected: "~/projects" },
    { input: "/root/projects", expected: "~/projects" },
    { input: "/home/alice", expected: "~" },
    { input: "/root", expected: "~" },
    { input: "/home", expected: "/home" },
    { input: "/var/log", expected: "/var/log" },
    { input: "/home/bob/a/b/c", expected: "~/a/b/c" },
  ])("shortenCwd($input) → $expected", ({ input, expected }) => {
    expect(shortenCwd(input)).toBe(expected);
  });
});

describe("cwdBasename", () => {
  it.each([
    { input: "/home/alice/projects", expected: "projects" },
    { input: "/home/alice", expected: "~" },
    { input: "/root", expected: "~" },
    { input: "/var/log", expected: "log" },
    { input: "/home/bob/a/b/c", expected: "c" },
    // A trailing slash names the same directory. Without the trim the split
    // pops the empty segment after it and the whole path collapses to the `~`
    // fallback — a terminal in `~/scratch/` reading as the home directory.
    { input: "/home/me/scratch/", expected: "scratch" },
    // Root has no last segment at all; the fallback keeps the projection from
    // ever handing a consumer the empty string.
    { input: "/", expected: "~" },
  ])("cwdBasename($input) → $expected", ({ input, expected }) => {
    expect(cwdBasename(input)).toBe(expected);
  });
});

/** Only the two arms — the collision machinery on top of them is
 *  `computeTerminalKeys`, exercised through its consumers. What matters here is
 *  that the git arm and the non-git arm are the ones every surface reads. */
describe("terminalKey", () => {
  it("names the repo and the branch inside a git worktree", () => {
    expect(
      terminalKey({
        cwd: "/home/me/src/kolu",
        git: git("/home/me/src/kolu", "kolu", "main"),
      }),
    ).toEqual({ group: "kolu", label: "main" });
  });

  it("names the basename and the shortened path outside one", () => {
    expect(terminalKey({ cwd: "/home/me/scratch", git: null })).toEqual({
      group: "scratch",
      label: "~/scratch",
    });
  });
});

/** The caption every title bar reads — the browser's clipboard PNG, padi's
 *  agent-facing PNG, and the printed scrollback. These cases came over from
 *  `padi/src/screenImage.test.ts`, where they pinned padi's own copy of this
 *  string; there is only one copy now, so they belong to it. */
describe("terminalCaption", () => {
  it("names the repo and branch when the terminal is in a git worktree", () => {
    expect(
      terminalCaption({
        cwd: "/src/kolu",
        git: git("/src/kolu", "kolu", "main"),
      }),
    ).toBe("kolu (main)");
  });

  it("falls back to the directory name outside a repo", () => {
    expect(terminalCaption({ cwd: "/home/me/scratch", git: null })).toBe(
      "scratch",
    );
  });

  it("does not parenthesise the non-git arm — that would print the same fact twice", () => {
    // `label` outside a repo is the shortened cwd, so "scratch (~/scratch)"
    // says nothing the first word didn't.
    expect(terminalCaption({ cwd: "/home/me/scratch", git: null })).not.toMatch(
      /\(/,
    );
  });

  it("ignores a trailing slash rather than captioning the picture with an empty string", () => {
    expect(terminalCaption({ cwd: "/home/me/scratch/", git: null })).toBe(
      "scratch",
    );
  });

  it("keeps the root path readable rather than collapsing it to nothing", () => {
    // `~`, `cwdBasename`'s documented no-last-segment fallback — the same thing
    // kolu's dock has always shown for a terminal at the filesystem root. The
    // caption agreeing with the tile beside it is the whole point.
    expect(terminalCaption({ cwd: "/", git: null })).toBe("~");
  });
});
