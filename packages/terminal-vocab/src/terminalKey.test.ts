/** The canonical `(group, label)` projection and the two path helpers it is
 *  built from.
 *
 *  Lives beside the projection rather than in whichever app happens to read it
 *  — these cases moved here from `kolu-client/src/path.test.ts` with the code,
 *  because "one projection" is only true if the thing pinning it is in the same
 *  package as the thing it pins. */

import { describe, expect, it } from "vitest";
import { cwdBasename, shortenCwd, terminalKey } from "./terminalKey.ts";

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
        git: {
          repoRoot: "/home/me/src/kolu",
          repoName: "kolu",
          worktreePath: "/home/me/src/kolu",
          branch: "main",
          isWorktree: false,
          mainRepoRoot: "/home/me/src/kolu",
          remoteUrl: null,
        },
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
