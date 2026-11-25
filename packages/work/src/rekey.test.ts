/**
 * A WORK RE-KEYED TO GIT'S ROOT — and NOTHING removed doing it.
 *
 * `rekeyed` on each of its three rows: the root's id is the work's own (the
 * key is stamped `git`), the id is free (the work moves there, in its place),
 * or another work holds it (this one keeps its old key, `held`; and is ended
 * when both were open). Over random stores, a re-key never drops a work and
 * never changes any work but the one re-keyed — a finished work's kept files
 * included — and the store reads back legal.
 *
 * And the one rule it keeps: no two OPEN works on one host, repository root
 * and branch, where git has said the root (`rootOf`).
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { seeded } from "./seeded.testlib.ts";
import {
  type BranchKey,
  endWork,
  InvalidWorkStore,
  openWork,
  parseStore,
  rekeyed,
  rootOf,
  storeFault,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkStoreValue,
  workIdOf,
} from "./index.ts";

const AT = "2026-11-24T19:00:00.000Z";

const branchKey = (
  repo: string,
  branch: string,
  repoBy: BranchKey["repoBy"],
): BranchKey => ({ kind: "branch", host: "local", repo, branch, repoBy });

const opened = (key: BranchKey, title = "t"): Work =>
  openWork({ key, title, at: AT, request: { kind: "none" } });

const finished = (key: BranchKey, title = "t"): Work => {
  const work = endWork(opened(key, title), {
    outcome: { kind: "stopped", by: "you" },
    at: AT,
  });
  return work.state.kind === "ended"
    ? { ...work, state: { ...work.state, kept: [{ path: "p", bytes: 1 }] } }
    : work;
};

const storeOf = (
  works: ReadonlyArray<Work>,
  members: ReadonlyArray<readonly [string, WorkMember]> = [],
): WorkStoreValue<WorkMember> =>
  parseStore(
    new Map(works.map((one) => [workIdOf(one.key), one])),
    new Map(members),
  );

const AS_WRITTEN = { kind: "as-written" } as const;
const GIT = { kind: "git" } as const;
const WORKTREE = "/repo/.worktrees/csv";

describe("re-keying a work to git's root", () => {
  it("stamps the key git when the root's id is its own", () => {
    const work = opened(branchKey("/repo", "csv", AS_WRITTEN));
    const id = workIdOf(work.key);
    const { value, rekey } = rekeyed(storeOf([work]), id, "/repo", AT);
    expect(rekey).toEqual({ kind: "stamped", ended: false });
    expect(value.works.get(id)?.key).toEqual(branchKey("/repo", "csv", GIT));
  });

  it("moves to a free id in its own place, members following", () => {
    const before = opened(branchKey("/a", "x", GIT), "before");
    const work = opened(branchKey(WORKTREE, "csv", AS_WRITTEN), "csv");
    const after = opened(branchKey("/b", "y", GIT), "after");
    const id = workIdOf(work.key);
    const store = storeOf(
      [before, work, after],
      [["local/t", { work: id, role: "planner", joinedAt: AT }]],
    );
    const { value, rekey } = rekeyed(store, id, "/repo", AT);
    const to = workIdOf(branchKey("/repo", "csv", GIT));
    expect(rekey).toEqual({ kind: "moved", to });
    expect([...value.works.keys()]).toEqual([
      workIdOf(before.key),
      to,
      workIdOf(after.key),
    ]);
    expect(value.works.get(to)?.key).toEqual(branchKey("/repo", "csv", GIT));
    expect(value.members.get("local/t")?.work).toBe(to);
  });

  it("keeps its old key, held, beside a finished work holding the root's id", () => {
    const holder = finished(branchKey("/repo", "csv", GIT), "holder");
    const work = opened(branchKey(WORKTREE, "csv", AS_WRITTEN), "csv");
    const id = workIdOf(work.key);
    const store = storeOf(
      [holder, work],
      [["local/t", { work: id, role: "planner", joinedAt: AT }]],
    );
    const { value, rekey } = rekeyed(store, id, "/repo", AT);
    expect(rekey).toEqual({
      kind: "held",
      by: workIdOf(holder.key),
      ended: false,
    });
    expect(value.works.get(workIdOf(holder.key))).toBe(holder);
    const kept = value.works.get(id);
    expect(kept?.key).toEqual(
      branchKey(WORKTREE, "csv", { kind: "held", root: "/repo" }),
    );
    expect(kept?.state.kind).toBe("open");
    expect(value.members.get("local/t")?.work).toBe(id);
  });

  it("is ended by kolu, and kept, when both works are open", () => {
    const holder = opened(branchKey("/repo", "csv", GIT), "holder");
    const work = opened(branchKey(WORKTREE, "csv", AS_WRITTEN), "csv");
    const id = workIdOf(work.key);
    const store = storeOf(
      [holder, work],
      [["local/t", { work: id, role: "planner", joinedAt: AT }]],
    );
    const { value, rekey } = rekeyed(store, id, "/repo", AT);
    expect(rekey).toEqual({
      kind: "held",
      by: workIdOf(holder.key),
      ended: true,
    });
    const kept = value.works.get(id);
    expect(kept?.state).toMatchObject({
      kind: "ended",
      outcome: { kind: "stopped", by: "kolu" },
    });
    expect(value.members.size).toBe(0);
    expect(value.works.get(workIdOf(holder.key))).toBe(holder);
  });

  it("never removes or changes another work, over any store", () => {
    const REPOS = ["/repo", WORKTREE, "/repo/sub", "/other"] as const;
    const ROOT: Record<(typeof REPOS)[number], string> = {
      "/repo": "/repo",
      [WORKTREE]: "/repo",
      "/repo/sub": "/repo",
      "/other": "/other",
    };
    let tried = 0;
    for (let seed = 1; tried < 300 && seed < 3000; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const works = new Map<WorkId, Work>();
      for (let i = 0; i < 6; i += 1) {
        const repo = among(REPOS);
        const arm = pick();
        const by: BranchKey["repoBy"] =
          arm < 0.34
            ? GIT
            : arm < 0.67
              ? AS_WRITTEN
              : { kind: "held", root: ROOT[repo] };
        // A `git` key's repo IS a root; the other two may be any path.
        const key = branchKey(
          by.kind === "git" ? ROOT[repo] : repo,
          among(["csv", "json"]),
          by,
        );
        const one =
          pick() < 0.5 ? opened(key, `w${i}`) : finished(key, `w${i}`);
        works.set(workIdOf(one.key), one);
      }
      if (Option.isSome(storeFault(works, new Map()))) continue;
      // Every key git has not named is re-keyed — as-written, and held
      // ones asked again.
      const candidates = [...works].filter(
        ([, one]) => one.key.kind === "branch" && one.key.repoBy.kind !== "git",
      );
      if (candidates.length === 0) continue;
      tried += 1;
      const [id, work] = among(candidates);
      if (work.key.kind !== "branch") continue;
      const store = parseStore(works, new Map<string, WorkMember>());
      const root = ROOT[work.key.repo as (typeof REPOS)[number]];
      const { value, rekey } = rekeyed(store, id, root, AT);
      const at = `seed ${seed}`;
      expect(value.works.size, at).toBe(store.works.size);
      for (const [other, before] of store.works) {
        if (other === id) continue;
        expect(value.works.get(other), at).toBe(before);
      }
      if (rekey.kind !== "moved") expect(value.works.has(id), at).toBe(true);
      expect(storeFault(value.works, value.members), at).toEqual(Option.none());
    }
    expect(tried).toBe(300);
  });

  it("ends the second old-key work on a branch whose holder has finished", () => {
    // A finished work holds the root's id; two open works on that branch
    // under two spellings. The first is kept, held; the second finds the
    // branch already running and is ended, kept under its old key.
    const holder = finished(branchKey("/repo", "csv", GIT), "holder");
    const first = opened(branchKey(WORKTREE, "csv", AS_WRITTEN), "first");
    const second = opened(branchKey("/repo/sub", "csv", AS_WRITTEN), "second");
    const store = storeOf([holder, first, second]);
    const once = rekeyed(store, workIdOf(first.key), "/repo", AT);
    expect(once.rekey).toMatchObject({ kind: "held", ended: false });
    const twice = rekeyed(once.value, workIdOf(second.key), "/repo", AT);
    expect(twice.rekey).toMatchObject({ kind: "held", ended: true });
    expect(twice.value.works.get(workIdOf(second.key))?.state).toMatchObject({
      kind: "ended",
      outcome: { kind: "stopped", by: "kolu" },
    });
    expect(storeFault(twice.value.works, twice.value.members)).toEqual(
      Option.none(),
    );
  });

  it("never moves an old-key work beside an open held work on its branch", () => {
    // The holder has left the list; an open held work runs the branch, and
    // an open as-written work on it finds the root's id free.
    const running = opened(
      branchKey(WORKTREE, "csv", { kind: "held", root: "/repo" }),
      "running",
    );
    const late = opened(branchKey("/repo/sub", "csv", AS_WRITTEN), "late");
    const { value, rekey } = rekeyed(
      storeOf([running, late]),
      workIdOf(late.key),
      "/repo",
      AT,
    );
    expect(rekey).toMatchObject({ kind: "held", ended: true });
    expect(value.works.has(workIdOf(late.key))).toBe(true);
    expect(storeFault(value.works, value.members)).toEqual(Option.none());
  });
});

describe("one open work per branch, where git has said the root", () => {
  it("reads the root git said off each arm, and none for as-written", () => {
    expect(rootOf(branchKey("/repo", "b", GIT))).toEqual(Option.some("/repo"));
    expect(
      rootOf(branchKey(WORKTREE, "b", { kind: "held", root: "/repo" })),
    ).toEqual(Option.some("/repo"));
    expect(rootOf(branchKey(WORKTREE, "b", AS_WRITTEN))).toEqual(Option.none());
  });

  it("refuses two open works on one host, root and branch", () => {
    expect(() =>
      storeOf([
        opened(branchKey("/repo", "csv", GIT)),
        opened(branchKey(WORKTREE, "csv", { kind: "held", root: "/repo" })),
      ]),
    ).toThrow(InvalidWorkStore);
  });

  it("accepts one open beside one ended, and keys whose root is not said", () => {
    expect(() =>
      storeOf([
        finished(branchKey("/repo", "csv", GIT)),
        opened(branchKey(WORKTREE, "csv", { kind: "held", root: "/repo" })),
        opened(branchKey("/repo/sub", "csv", AS_WRITTEN)),
      ]),
    ).not.toThrow();
  });
});
