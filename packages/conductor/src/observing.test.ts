/**
 * WHAT AN OBSERVATION MEANS TO A WORK, pinned by CALLING it.
 *
 * The padi↔timeline translation used to be three closures inside a 2,800-line
 * host, reachable only by standing one up with three stores, a files port, a
 * spawn and a proven MCP endpoint — while its two siblings in the same chain
 * (`./readings.ts`, `./members.ts`) were modules with unit tests beside them.
 * These are the same rules, exercised the same way.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK,
  aboutMember,
  type CheckHead,
  endedAt,
  endWork,
  joinWork,
  openWork,
  outcomeOf,
  type PrReading,
  prOf,
  recordEvent,
  type Work,
} from "kolu-work";
import { fileEvents, prEvents, ringEvent } from "./observing.ts";
import type { WatchChecks, WatchPr } from "./observation.ts";

const AT = "2026-02-01T10:00:00.000Z";
const A = "local/aaaa";
const B = "remote:box/bbbb";

/** Two members in ONE worktree, which is the shape the defect needs: both
 *  terminals' records carry a reading of the same pull request. */
const work = (): Work =>
  joinWork(
    joinWork(
      openWork({
        key: {
          kind: "branch",
          host: "local",
          repo: "/srv/repo",
          branch: "fix-the-parser",
        },
        title: "fix the parser",
        at: AT,
        request: { kind: "said", text: "fix it" },
      }),
      { terminal: A, role: "implementor", at: AT },
    ),
    { terminal: B, role: "planner", at: AT },
  );

/** The commit the checks are about — a forge's oid, as padi now reports it. */
const HEAD: CheckHead = {
  kind: "commit",
  sha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
};
const PUSHED: CheckHead = {
  kind: "commit",
  sha: "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5",
};
/** A host whose padi predates the field says nothing about commits. */
const NO_HEAD: CheckHead = { kind: "unreported" };

/** The forge's rollup over a PR's checks. */
const rolled = (rollup: "pending" | "pass" | "fail"): WatchChecks => ({
  kind: "rollup",
  rollup,
});

/** What the timeline last said about the PR's checks. */
const checksOf = (one: Work): Option.Option<PrReading["checks"]> =>
  Option.map(prOf(one), (pr) => pr.checks);

const pr = (over: Partial<WatchPr> = {}): WatchPr => ({
  number: 7,
  title: "Fix the parser",
  state: "open",
  checks: { kind: "unreported" },
  failing: [],
  head: HEAD,
  ...over,
});

const kinds = (one: Work): ReadonlyArray<string> =>
  one.events.map((event) => event.kind);

describe("what a ring puts on the timeline", () => {
  it("spells an agent's four states as themselves, by the agent", () => {
    for (const level of ["ready", "stopped", "asking", "exited"] as const) {
      expect(ringEvent(A, level, AT)).toEqual(
        Option.some({
          at: AT,
          by: "agent",
          kind: level,
          about: aboutMember(A),
          why: { kind: "none" },
        }),
      );
    }
  });

  it("says a terminal put away is kolu's doing, not an agent's", () => {
    expect(Option.getOrThrow(ringEvent(A, "asleep", AT))).toMatchObject({
      by: "kolu",
      kind: "asleep",
    });
  });

  it("spells a brief that never started as an exit, and says which kind", () => {
    // For a reader of the timeline "the command ended with no agent ever in
    // it" is the same ending as an exit — by kolu, because there was no agent
    // there to do it.
    expect(Option.getOrThrow(ringEvent(A, "ended", AT))).toMatchObject({
      by: "kolu",
      kind: "exited",
      why: { kind: "reason", text: "ended without an agent" },
    });
  });

  it("writes nothing for the three that are not readings of an agent", () => {
    // `gone` is a member LEAVING (`leaveWork` writes that with its reason);
    // the two hand-overs are written where the keys actually changed hands.
    expect(ringEvent(A, "gone", AT)).toEqual(Option.none());
    expect(ringEvent(A, "taken-over", AT)).toEqual(Option.none());
    expect(ringEvent(A, "handed-back", AT)).toEqual(Option.none());
  });
});

describe("the PR the work's own watch reads", () => {
  it("records the pull request ONCE, and says so with no terminal", () => {
    const opened = prEvents(work(), pr(), AT);
    expect(kinds(opened)).toContain("pr-opened");
    expect(opened.events.at(-1)).toMatchObject({
      kind: "pr-opened",
      by: "kolu",
      about: ABOUT_WORK,
      pr: 7,
    });
    // The comparison is against the TIMELINE, so the next poll — and the
    // first look after a restart — records nothing.
    expect(prEvents(opened, pr(), AT)).toBe(opened);
  });

  it("steps the checks through the ONE table, and names the failures", () => {
    let one = prEvents(work(), pr({ checks: rolled("pending") }), AT);
    expect(checksOf(one)).toEqual(Option.some("running"));
    // The same rollup again is the same reading: nothing is written.
    expect(prEvents(one, pr({ checks: rolled("pending") }), AT)).toBe(one);
    one = prEvents(
      one,
      pr({ checks: rolled("fail"), failing: ["build", "lint"] }),
      AT,
    );
    expect(checksOf(one)).toEqual(Option.some("failed"));
    expect(one.events.at(-1)).toMatchObject({
      kind: "checks-failed",
      by: "ci",
      about: ABOUT_WORK,
      pr: 7,
      head: HEAD,
      failing: ["build", "lint"],
    });
    one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    expect(checksOf(one)).toEqual(Option.some("passed"));
  });

  // THE DEFECT THIS GUARDS (juspay/kolu#2376): the work used to learn its PR
  // from every member's record, so two terminals in one worktree thirty
  // seconds out of step wrote a check event each, every frame, for as long as
  // they disagreed — 429 of the human's real work's 465 events. There is ONE
  // reader now, and the poll is what repeats.
  it("writes a HANDFUL of events for five hundred polls of one PR", () => {
    let one = prEvents(work(), pr({ checks: rolled("pending") }), AT);
    for (let poll = 0; poll < 500; poll += 1) {
      one = prEvents(one, pr({ checks: rolled("pending") }), AT);
      one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    }
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
    expect(kinds(one).filter((kind) => kind === "pr-opened")).toHaveLength(1);
  });

  it("says WHICH COMMIT a check event is about, so a push reads as one", () => {
    let one = prEvents(work(), pr({ checks: rolled("pending") }), AT);
    one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    // A push: the same rollup word about a different commit is news.
    one = prEvents(one, pr({ checks: rolled("pending"), head: PUSHED }), AT);
    expect(kinds(one).filter((kind) => kind.startsWith("checks-"))).toEqual([
      "checks-running",
      "checks-passed",
      "checks-running",
    ]);
    expect(one.events.at(-1)).toMatchObject({ head: PUSHED, pr: 7 });
    // ... and the new commit's checks running is still recorded once.
    expect(
      prEvents(one, pr({ checks: rolled("pending"), head: PUSHED }), AT),
    ).toBe(one);
  });

  it("hears a reading with NO head once per kind, ever", () => {
    // A host whose padi predates the field says nothing about commits, so
    // there is nothing to tell two readings apart with — and the honest
    // reading of that is one event per kind, not one per poll.
    let one = prEvents(
      work(),
      pr({ checks: rolled("pending"), head: NO_HEAD }),
      AT,
    );
    one = prEvents(one, pr({ checks: rolled("pass"), head: NO_HEAD }), AT);
    one = prEvents(one, pr({ checks: rolled("pending"), head: NO_HEAD }), AT);
    one = prEvents(one, pr({ checks: rolled("pass"), head: NO_HEAD }), AT);
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
  });

  it("ENDS the work when the PR merges, and when it closes", () => {
    const merged = prEvents(work(), pr({ state: "merged" }), AT);
    expect(kinds(merged)).toContain("merged");
    expect(outcomeOf(merged)).toEqual(Option.some({ kind: "merged", pr: 7 }));
    expect(endedAt(merged)).toEqual(Option.some(AT));

    const closed = prEvents(work(), pr({ state: "closed" }), AT);
    expect(outcomeOf(closed)).toEqual(Option.some({ kind: "closed", pr: 7 }));
  });

  it("ends a MERGED work whose members are all gone, on the first look", () => {
    // The real sequence (#2376): the Conductor merged #181 and closed both
    // terminals fourteen seconds later, with no poll in between. The work is
    // open, has no members, and the next look is what ends it.
    const abandoned = recordEvent(
      recordEvent(work(), {
        at: AT,
        by: "kolu",
        kind: "left",
        about: aboutMember(A),
        why: "closed",
      }),
      {
        at: AT,
        by: "kolu",
        kind: "left",
        about: aboutMember(B),
        why: "closed",
      },
    );
    const ended = prEvents(abandoned, pr({ number: 181, state: "merged" }), AT);
    expect(outcomeOf(ended)).toEqual(Option.some({ kind: "merged", pr: 181 }));
    // The pull request is on the timeline too: kolu never saw it opened, and
    // a merge of a PR nobody recorded is still this work's merge.
    expect(kinds(ended)).toContain("pr-opened");
  });

  it("NEVER brings a work back: the forge can end one, not reopen it", () => {
    // The scope of PR observation is the works IN PROGRESS
    // (`workStore.prWatches`), so a finished work's branch is not asked about
    // at all. Even handed the reading directly, nothing here undoes an
    // ending — Reopen on the card, or `work_open` on the same key, is the one
    // way back.
    const closed = prEvents(work(), pr({ state: "closed" }), AT);
    expect(closed.state.kind).toBe("ended");
    const again = prEvents(closed, pr({ state: "open" }), AT);
    expect(again.state.kind).toBe("ended");
    expect(kinds(again)).not.toContain("reopened");
    // ... and it is the very value that went in: nothing was written.
    expect(again).toBe(closed);
  });

  it("leaves a work somebody STOPPED stopped, PR open or not", () => {
    const stopped = endWork(prEvents(work(), pr(), AT), {
      outcome: { kind: "stopped", by: "you" },
      at: AT,
    });
    expect(prEvents(stopped, pr({ state: "open" }), AT)).toBe(stopped);
  });

  it("follows the branch: a number the timeline has not got is an opening", () => {
    // One reader, asking the forge about THIS branch — so a different number
    // is not a second opinion, it is the next pull request on the branch.
    const first = prEvents(work(), pr(), AT);
    const next = prEvents(first, pr({ number: 9, title: "Other" }), AT);
    expect(Option.map(prOf(next), (one) => one.number)).toEqual(Option.some(9));
    expect(kinds(next).filter((kind) => kind === "pr-opened")).toHaveLength(2);
    expect(prEvents(next, pr({ number: 9, title: "Other" }), AT)).toBe(next);
  });

  // THE PROPERTY: an observation is a question about what the timeline
  // already says, so replaying every reading a work ever had adds nothing.
  // A deterministic sweep rather than a random one — the repo has no
  // fast-check — over every reading the watch can make about one PR.
  it("appends NOTHING when the same readings are fed again", () => {
    const checks: ReadonlyArray<WatchChecks> = [
      rolled("pending"),
      rolled("pass"),
      rolled("fail"),
      { kind: "unreported" },
    ];
    const heads = [HEAD, PUSHED, NO_HEAD];
    const readings = checks.flatMap((check) =>
      heads.map((head) =>
        pr({
          checks: check,
          head,
          failing:
            check.kind === "rollup" && check.rollup === "fail" ? ["ci"] : [],
        }),
      ),
    );
    let settled = work();
    for (const one of readings) settled = prEvents(settled, one, AT);
    const events = settled.events.length;
    // Every reading again, twice, in a different order — the work is the very
    // value that went in.
    for (const one of [...readings].reverse())
      settled = prEvents(settled, one, AT);
    for (const one of readings) settled = prEvents(settled, one, AT);
    expect(settled.events).toHaveLength(events);
  });
});

describe("the files a listing found", () => {
  it("puts every path kolu has not seen before on the timeline, once", () => {
    const first = fileEvents(work(), A, [".waterfall/plan.md"], AT);
    expect(first.events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      about: aboutMember(A),
      path: ".waterfall/plan.md",
    });
    // Listed again — the same file is not news a second time, and the work is
    // the very value that went in.
    expect(fileEvents(first, A, [".waterfall/plan.md"], AT)).toBe(first);
    const second = fileEvents(
      first,
      A,
      [".waterfall/plan.md", ".waterfall/notes.md"],
      AT,
    );
    expect(second.events.filter((event) => event.kind === "file")).toHaveLength(
      2,
    );
  });

  it("reads what kolu has seen off the RECORD, so a restart adds nothing", () => {
    // The file event is the memory: a second process listing the same
    // directory compares against the timeline it restored.
    const restarted = recordEvent(work(), {
      at: AT,
      by: "agent",
      kind: "file",
      about: aboutMember(B),
      path: ".waterfall/plan.md",
    });
    expect(fileEvents(restarted, A, [".waterfall/plan.md"], AT)).toBe(
      restarted,
    );
  });
});
