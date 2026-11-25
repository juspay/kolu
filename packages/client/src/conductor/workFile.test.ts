/**
 * WHICH TERMINAL A WORK'S FILES BORROW. A picture in a work's worktree is
 * fetched through a terminal's file route, which serves a path under that
 * terminal's CURRENT repository. So the terminal borrowed must stand in the
 * work's worktree: a member that changed directory into another repository
 * would have the work's picture fetched from there.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { Work } from "kolu-work";
import { describe, expect, it } from "vitest";
import type { MemberLine } from "./workFacts";
import { workPlaceOf } from "./workFile";

const WORKTREE = "/srv/code/kestrel/.worktrees/export";

const work: Work = {
  key: {
    kind: "branch",
    host: "local",
    repo: "/srv/code/kestrel",
    branch: "feat/export",
    repoBy: "git",
  },
  title: "Export the ledger",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree: { kind: "at", path: WORKTREE },
};

/** A member terminal here on the work's host, standing in `repoRoot`. */
const memberIn = (
  id: string,
  repoRoot: string,
  isBare = false,
): MemberLine => ({
  terminal: `local/${id}`,
  member: {
    work: "w",
    role: "implementor",
    joinedAt: "2026-01-01T00:00:00Z",
  } as never,
  split: { host: "local", id },
  standing: {
    kind: "here",
    meta: {
      state: "active",
      cwd: repoRoot,
      git: {
        kind: "repo",
        info: {
          repoRoot,
          repoName: "kestrel",
          worktreePath: repoRoot,
          branch: "feat/export",
          isWorktree: true,
          mainRepoRoot: "/srv/code/kestrel",
          remoteUrl: null,
          isBare,
        },
      },
      location: LOCAL_LOCATION,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
      lastActivityAt: 0,
      promptedAt: null,
    } as TerminalMetadata,
  },
});

const ELSEWHERE = "11111111-1111-4111-8111-111111111111";
const INSIDE = "22222222-2222-4222-8222-222222222222";
const elsewhere = memberIn(ELSEWHERE, "/srv/code/other-repo");
const inside = memberIn(INSIDE, WORKTREE);

describe("the terminal a work's files borrow", () => {
  it("is never a member standing in another repository", () => {
    expect(workPlaceOf(work, [elsewhere])).toEqual({
      host: "local",
      repoPath: WORKTREE,
      terminalId: null,
      lister: "git",
    });
  });

  it("is the member standing in the worktree", () => {
    expect(workPlaceOf(work, [elsewhere, inside])?.terminalId).toBe(INSIDE);
  });
});

describe("who lists a work's worktree", () => {
  it("is git, read by the member standing in it", () => {
    expect(workPlaceOf(work, [inside])?.lister).toBe("git");
  });

  it("is the disk when that member's git reading says git cannot list it", () => {
    const bare = memberIn(INSIDE, WORKTREE, true);
    expect(workPlaceOf(work, [bare])?.lister).toBe("disk");
  });

  it("is git with no member standing in it — never another repository's reading", () => {
    const bareElsewhere = memberIn(ELSEWHERE, "/srv/code/other-repo", true);
    expect(workPlaceOf(work, [bareElsewhere])?.lister).toBe("git");
  });
});
