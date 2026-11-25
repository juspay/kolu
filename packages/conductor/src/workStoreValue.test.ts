/**
 * THE WORKS AND THEIR MEMBERS ARE ONE VALUE, parsed on every write.
 *
 * A random walk over everything that moves a work — open, join, leave, stop,
 * reopen, a PR reading, a decline, a checkout answer, a re-key of a work
 * kept under an old key, a watch and the terminals offered to it — and after
 * every step the store reads back legal (`kolu-work`'s `storeFault` is
 * none). And a write forced to break a rule throws before anything is
 * assigned: what was there is still there, whole.
 */

import { setImmediate as settle } from "node:timers/promises";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Option } from "effect";
import {
  type BranchKey,
  endWork,
  InvalidWorkStore,
  openWork,
  storeFault,
  type Work,
  type WorkId,
  workIdOf,
  type WorkRole,
  WorkRefusal,
} from "kolu-work";
import { seeded } from "kolu-work/seeded";
import { describe, expect, it } from "vitest";
import { joined } from "./memberStore.ts";
import { workRig as rig } from "./workRig.testlib.ts";

/** The forge's answer for a branch. */
const forge = (number: number, state: "open" | "merged" | "closed") =>
  ({
    kind: "ok",
    value: {
      number,
      title: "t",
      url: `https://example.invalid/pull/${number}`,
      state,
      checks: "pending",
      checkRuns: [],
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
      headSha: null,
      isDraft: false,
    },
  }) satisfies PrResult;

const BRANCHES = ["csv", "json", "xml"] as const;
const TERMINALS = ["local/a", "local/b", "local/c", "local/d"] as const;
const ROLES: ReadonlyArray<WorkRole> = ["planner", "implementor", "other"];
/** Where works kept from before keys were git's were opened. */
const OLD_REPOS = ["/repo/.worktrees/w", "/repo/sub"] as const;

/** A store kolu kept from before: works under keys git never named, some
 *  finished. */
const keptFromBefore = (pick: () => number): Record<WorkId, Work> => {
  const among = <T>(of: ReadonlyArray<T>): T =>
    of[Math.floor(pick() * of.length)] as T;
  const works: Record<WorkId, Work> = {};
  for (let i = 0; i < 4; i += 1) {
    const key: BranchKey = {
      kind: "branch",
      host: "local",
      repo: among(OLD_REPOS),
      branch: among(BRANCHES),
      // Kept from before keys were git's, or held under an old key.
      repoBy:
        pick() < 0.5 ? { kind: "as-written" } : { kind: "held", root: "/repo" },
    };
    const opened = openWork({
      key,
      title: `old ${i}`,
      at: "2026-11-24T19:00:00.000Z",
      request: { kind: "none" },
    });
    works[workIdOf(key)] =
      pick() < 0.5
        ? endWork(opened, {
            outcome: { kind: "stopped", by: "you" },
            at: "2026-11-24T19:00:00.000Z",
          })
        : opened;
  }
  return works;
};

describe("the works and their members, as one value", () => {
  it("reads back legal after every step of any walk", async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const r = rig();
      const before = keptFromBefore(pick);
      // Two open works held from one root on one branch is a store the
      // rules refuse; that seed starts from another.
      if (Option.isSome(storeFault(before, {}))) continue;
      r.works.load(before, {}, {});
      for (let step = 0; step < 60; step += 1) {
        const roll = pick();
        const ids = r.works.all().map(([one]) => one);
        const id = among(ids);
        try {
          if (roll < 0.12 || id === undefined) {
            r.works.openFor({
              key: {
                kind: "branch",
                host: "local",
                repo: "/repo",
                branch: among(BRANCHES),
                repoBy: { kind: "git" },
              },
              title: "t",
              request: { kind: "none" },
            });
          } else if (roll < 0.16) {
            r.works.openFor({
              key: { kind: "watch", host: "local", id: among(["a", "b"]) },
              title: "w",
              request: { kind: "none" },
            });
          } else if (roll < 0.36) {
            r.works.join(id, among(TERMINALS), among(ROLES), "asked");
          } else if (roll < 0.44) {
            r.works.leave(among(TERMINALS), among(["closed", "gone"]));
          } else if (roll < 0.5) {
            r.works.stop(id, "you");
          } else if (roll < 0.56) {
            r.works.reopen(id);
          } else if (roll < 0.7) {
            r.watch.observedPr(
              id,
              forge(
                Math.floor(pick() * 3) + 1,
                among(["open", "open", "open", "merged", "closed"]),
              ),
            );
          } else if (roll < 0.8) {
            r.watch.observedCheckout(id, {
              kind: "repository",
              root: "/repo",
              checkout: { kind: "at", path: among(OLD_REPOS) },
            });
          } else if (roll < 0.9) {
            const unrooted = r.works.unrooted("local", among(BRANCHES));
            const one = unrooted[Math.floor(pick() * unrooted.length)];
            if (one !== undefined) await r.works.rekey(one.id, "/repo");
          } else r.works.declined(id);
        } catch (err) {
          // A refusal is the store saying no to a caller — a role taken, a
          // work that has ended — and nothing was written.
          if (!(err instanceof WorkRefusal)) throw err;
        }
        await settle();
        await settle();
        // A defect the store or the observer caught to keep going — a store
        // fault out of a re-key — fails the walk as surely as a throw.
        expect(r.errors, `seed ${seed}, step ${step}`).toEqual([]);
        expect(
          storeFault(Object.fromEntries(r.works.all()), r.works.members.all()),
          `seed ${seed}, step ${step}`,
        ).toEqual(Option.none());
      }
    }
  });

  it("throws a write that breaks a rule before anything is assigned", () => {
    const r = rig();
    const csv = r.works.openFor({
      key: {
        kind: "branch",
        host: "local",
        repo: "/repo",
        branch: "csv",
        repoBy: { kind: "git" },
      },
      title: "csv",
      request: { kind: "none" },
    }).id;
    r.works.join(csv, "local/a", "planner", "asked");
    const works = r.works.persisted();
    const members = r.works.members.all();

    // A second planner, written past `join`'s own refusal.
    expect(() =>
      r.works.members.set(
        "local/b",
        joined(
          {
            work: csv,
            role: "planner",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          "asked",
        ),
      ),
    ).toThrow(InvalidWorkStore);
    // A member of a work kolu does not hold.
    expect(() =>
      r.works.members.set(
        "local/c",
        joined(
          {
            work: "branch:local/%2Frepo/nowhere",
            role: "other",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          "asked",
        ),
      ),
    ).toThrow(InvalidWorkStore);

    expect(r.works.persisted()).toEqual(works);
    expect(r.works.members.all()).toBe(members);
  });
});
