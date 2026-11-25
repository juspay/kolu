/**
 * THE PR READING IS ABOUT ONE PULL REQUEST, AND A MERGE IS FINAL.
 *
 * - T17: over random event lists, the reading's number is the last
 *   `pr-opened`'s, and what it says about checks and the merge answer is
 *   about that number — an event naming another PR moves nothing.
 * - T18: once #N merged (or closed), no event list without a new
 *   `pr-opened` reads it as open — a Reopen included.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { seeded } from "./seeded.testlib.ts";
import { prOf } from "./readings.ts";
import { ABOUT_WORK, type Work, type WorkEvent } from "./schema.ts";
import { openWork } from "./record.ts";

const AT = "2026-11-24T19:00:00.000Z";
const HEAD = { kind: "commit", sha: "a1" } as const;

const blank = (): Work =>
  openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/repo",
      branch: "csv",
      repoBy: { kind: "git" },
    },
    title: "csv",
    at: AT,
    request: { kind: "none" },
  });

/** A timeline made of exactly these events — the fold's input, built
 *  without a transition so any order can be asked about. */
const timeline = (events: ReadonlyArray<WorkEvent>): Work => ({
  ...blank(),
  events: [...events],
});

const forgeEvent = (pick: () => number, pr: number): WorkEvent => {
  const roll = pick();
  const base = { at: AT, about: ABOUT_WORK } as const;
  if (roll < 0.15)
    return {
      ...base,
      by: "kolu",
      kind: "pr-opened",
      pr,
      title: `#${pr}`,
      url: { kind: "link", href: `https://forge.example/pull/${pr}` },
      draft: "ready",
    };
  if (roll < 0.4)
    return {
      ...base,
      by: "ci",
      kind: pick() < 0.5 ? "checks-passed" : "checks-failed",
      pr,
      head: HEAD,
      failing: [],
    };
  if (roll < 0.6)
    return {
      ...base,
      by: "kolu",
      kind: "merge-state",
      pr,
      head: HEAD,
      merge: { kind: "can" },
    };
  if (roll < 0.7)
    return {
      ...base,
      by: "kolu",
      kind: "draft-state",
      pr,
      draft: pick() < 0.5 ? "draft" : "ready",
    };
  if (roll < 0.8) return { ...base, by: "kolu", kind: "merged", pr };
  if (roll < 0.88) return { ...base, by: "kolu", kind: "pr-closed", pr };
  return { ...base, by: "kolu", kind: "reopened" };
};

const walk = (seed: number): ReadonlyArray<WorkEvent> => {
  const pick = seeded(seed);
  return Array.from({ length: 4 + Math.floor(pick() * 24) }, () =>
    forgeEvent(pick, 1 + Math.floor(pick() * 3)),
  );
};

describe("the PR reading", () => {
  it("is about the last opened PR, whatever other PRs the events name (T17)", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const events = walk(seed);
      const opened = events.filter((one) => one.kind === "pr-opened").at(-1);
      const read = prOf(timeline(events));
      if (opened === undefined || opened.kind !== "pr-opened") {
        expect(read, `seed ${seed}`).toEqual(Option.none());
        continue;
      }
      const pr = Option.getOrThrow(read);
      expect(pr.number, `seed ${seed}`).toBe(opened.pr);
      const named = [
        Option.map(pr.lastCheck, (one) => one.pr),
        Option.map(pr.lastMerge, (one) => one.pr),
      ];
      for (const one of named)
        if (Option.isSome(one))
          expect(one.value, `seed ${seed}`).toBe(opened.pr);
    }
  });

  it("never reads a merged or closed PR as open again without a new opening (T18)", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const events = walk(seed);
      events.forEach((event, at) => {
        if (event.kind !== "merged" && event.kind !== "pr-closed") return;
        const before = prOf(timeline(events.slice(0, at)));
        // The end only counts for the PR the reading was about.
        if (!Option.exists(before, (one) => one.number === event.pr)) return;
        for (let to = at + 1; to <= events.length; to += 1) {
          const after = events.slice(at + 1, to);
          if (after.some((one) => one.kind === "pr-opened")) break;
          const read = prOf(timeline(events.slice(0, to)));
          expect(
            Option.exists(read, (one) => one.state === "open"),
            `seed ${seed}, ended at ${at}, read to ${to}`,
          ).toBe(false);
        }
      });
    }
  });
});
