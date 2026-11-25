/**
 * THE WORKS AND THEIR MEMBERS ARE ONE VALUE, parsed on every write.
 *
 * A random walk over everything that moves a work — open, join, leave, stop,
 * reopen, a PR reading, a decline — and after every step the store reads
 * back legal (`kolu-work`'s `storeFault` is none). And a write forced to
 * break a rule throws before anything is assigned: what was there is still
 * there, whole.
 */

import { setImmediate as settle } from "node:timers/promises";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Option } from "effect";
import {
  InvalidWorkStore,
  storeFault,
  type WorkId,
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

describe("the works and their members, as one value", () => {
  it("reads back legal after every step of any walk", async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const r = rig();
      const ids: WorkId[] = [];
      for (let step = 0; step < 60; step += 1) {
        const roll = pick();
        const id = among(ids);
        try {
          if (roll < 0.15 || id === undefined) {
            const opened = r.works.openFor({
              key: {
                kind: "branch",
                host: "local",
                repo: "/repo",
                branch: among(BRANCHES),
                repoBy: "git",
              },
              title: "t",
              request: { kind: "none" },
            });
            if (!ids.includes(opened.id)) ids.push(opened.id);
          } else if (roll < 0.4) {
            r.works.join(id, among(TERMINALS), among(ROLES), "asked");
          } else if (roll < 0.5) {
            r.works.leave(among(TERMINALS), among(["closed", "gone"]));
          } else if (roll < 0.58) {
            r.works.stop(id, "you");
          } else if (roll < 0.66) {
            r.works.reopen(id);
          } else if (roll < 0.9) {
            r.watch.observedPr(
              id,
              forge(
                Math.floor(pick() * 3) + 1,
                among(["open", "open", "open", "merged", "closed"]),
              ),
            );
          } else if (r.works.declined(id)) {
            ids.splice(ids.indexOf(id), 1);
          }
        } catch (err) {
          // A refusal is the store saying no to a caller — a role taken, a
          // work that has ended — and nothing was written.
          if (!(err instanceof WorkRefusal)) throw err;
        }
        await settle();
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
        repoBy: "git",
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
