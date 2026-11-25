/**
 * T23: A WORK'S COMMENTS ARE THE WORK'S. Over any members — none, one
 * standing in the work's folder, one standing elsewhere, in any order, on
 * any host — the comments a work's reader shows and sends depend only on the
 * work's id and the path: its source files them in the work's own queue,
 * and a finished work's kept copy takes none.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { endWork, type Work, type WorkId } from "kolu-work";
import { seeded } from "kolu-work/testlib";
import { describe, expect, it } from "vitest";
import { useComments } from "../comments/useComments";
import type { MemberLine } from "./workFacts";
import { workFileSource } from "./workFile";

const WORKTREE = "/srv/code/kestrel/.worktrees/export";
const ID: WorkId = "branch:local/%2Fsrv%2Fcode%2Fkestrel/feat%2Fexport";
const PATH = ".waterfall/plan.md";

const work: Work = {
  key: {
    kind: "branch",
    host: "local",
    repo: "/srv/code/kestrel",
    branch: "feat/export",
    repoBy: { kind: "git" },
  },
  title: "Export the ledger",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree: { kind: "at", path: WORKTREE },
};

/** A member terminal on `host`, standing in `repoRoot`. */
const memberIn = (host: string, id: string, repoRoot: string): MemberLine => ({
  terminal: `${host}/${id}`,
  member: {
    work: ID,
    role: "implementor",
    joinedAt: "2026-01-01T00:00:00Z",
  } as never,
  split: { host, id },
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
          isBare: false,
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

const POOL: ReadonlyArray<MemberLine> = [
  memberIn("local", "11111111-1111-4111-8111-111111111111", WORKTREE),
  memberIn("local", "22222222-2222-4222-8222-222222222222", "/srv/elsewhere"),
  memberIn("remote:box", "33333333-3333-4333-8333-333333333333", WORKTREE),
];

describe("a work's comments", () => {
  it("depend only on the work and the path, whoever its members are (T23)", () => {
    const filed = workFileSource(ID, work, []).comments;
    expect(filed).toEqual({ kind: "work", id: ID });
    if (filed === null) throw new Error("a live work files comments");
    // Written with NO member at all.
    useComments(filed).add({
      path: PATH,
      locator: { quote: "the plan", prefix: "", suffix: "" },
      body: "Say why",
    });
    for (let seed = 1; seed <= 100; seed += 1) {
      const pick = seeded(seed);
      const members = POOL.filter(() => pick() < 0.5).sort(() => pick() - 0.5);
      const queue = workFileSource(ID, work, members).comments;
      expect(queue, `seed ${seed}`).toEqual(filed);
      if (queue === null) continue;
      expect(
        useComments(queue)
          .commentsForPath(PATH)
          .map((c) => c.body),
        `seed ${seed}`,
      ).toEqual(["Say why"]);
    }
  });

  it("are none for a finished work's kept copy", () => {
    const ended = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: "2026-01-02T00:00:00.000Z",
    });
    expect(workFileSource(ID, ended, POOL).comments).toBeNull();
  });
});
