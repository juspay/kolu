/**
 * WHAT AN OBSERVATION MEANS TO A WORK, pinned by CALLING it.
 *
 * The padi↔timeline translation used to be three closures inside a 2,800-line
 * host, reachable only by standing one up with three stores, a files port, a
 * spawn and a proven MCP endpoint — while its two siblings in the same chain
 * (`./readings.ts`, `./members.ts`) were modules with unit tests beside them.
 * These are the same rules, exercised the same way.
 */

import { describe, expect, it } from "vitest";
import {
  endWork,
  joinWork,
  openWork,
  outcomeOf,
  endedAt,
  prOf,
  recordEvent,
  type Work,
} from "kolu-work";
import { fileEvents, prEvents, ringEvent } from "./observing.ts";
import type { WatchPr } from "./observation.ts";

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
        request: "fix it",
      }),
      { terminal: A, role: "implementor", at: AT },
    ),
    { terminal: B, role: "planner", at: AT },
  );

/** The commit the checks are about — a forge's oid, as padi now reports it. */
const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";
const PUSHED = "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5";

const pr = (over: Partial<WatchPr> = {}): WatchPr => ({
  number: 7,
  title: "Fix the parser",
  state: "open",
  checks: null,
  failing: [],
  head: HEAD,
  ...over,
});

const kinds = (one: Work): ReadonlyArray<string> =>
  one.events.map((event) => event.kind);

describe("what a ring puts on the timeline", () => {
  it("spells an agent's four states as themselves, by the agent", () => {
    for (const level of ["ready", "stopped", "asking", "exited"] as const) {
      expect(ringEvent(A, level, AT)).toEqual({
        at: AT,
        by: "agent",
        kind: level,
        terminal: A,
        why: "",
      });
    }
  });

  it("says a terminal put away is kolu's doing, not an agent's", () => {
    expect(ringEvent(A, "asleep", AT)).toMatchObject({
      by: "kolu",
      kind: "asleep",
    });
  });

  it("spells a brief that never started as an exit, and says which kind", () => {
    // For a reader of the timeline "the command ended with no agent ever in
    // it" is the same ending as an exit — by kolu, because there was no agent
    // there to do it.
    expect(ringEvent(A, "ended", AT)).toMatchObject({
      by: "kolu",
      kind: "exited",
      why: "ended without an agent",
    });
  });

  it("writes nothing for the three that are not readings of an agent", () => {
    // `gone` is a member LEAVING (`leaveWork` writes that with its reason);
    // the two hand-overs are written where the keys actually changed hands.
    expect(ringEvent(A, "gone", AT)).toBeNull();
    expect(ringEvent(A, "taken-over", AT)).toBeNull();
    expect(ringEvent(A, "handed-back", AT)).toBeNull();
  });
});

describe("the PR a reading carries", () => {
  it("records one PR ONCE however many members see it", () => {
    const opened = prEvents(work(), A, pr(), AT);
    expect(kinds(opened)).toContain("pr-opened");
    // The comparison is against the TIMELINE, not against the last reading —
    // so the second member looking at the same PR records nothing.
    expect(prEvents(opened, B, pr(), AT)).toBe(opened);
  });

  it("steps the checks through the ONE table, and names the failures", () => {
    let one = prEvents(work(), A, pr({ checks: "pending" }), AT);
    expect(prOf(one)?.checks).toBe("running");
    // The same rollup again is the same reading: nothing is written.
    expect(prEvents(one, A, pr({ checks: "pending" }), AT)).toBe(one);
    one = prEvents(
      one,
      A,
      pr({ checks: "fail", failing: ["build", "lint"] }),
      AT,
    );
    expect(prOf(one)?.checks).toBe("failed");
    expect(one.events.at(-1)).toMatchObject({
      kind: "checks-failed",
      by: "ci",
      pr: 7,
      head: HEAD,
      failing: ["build", "lint"],
    });
    one = prEvents(one, A, pr({ checks: "pass" }), AT);
    expect(prOf(one)?.checks).toBe("passed");
  });

  // THE DEFECT THIS GUARDS (juspay/kolu#2376): two members in one worktree,
  // thirty seconds out of step with each other, so one record says the checks
  // are running while the other says they passed — and the observer ran on
  // every frame of the host. The human's real work carried 429 of these.
  it("writes a HANDFUL of events when two members disagree for a long time", () => {
    let one = prEvents(work(), A, pr({ checks: "pending" }), AT);
    for (let frame = 0; frame < 500; frame += 1) {
      // The implementor's record still says pending; the planner's already
      // says pass. Both are read on every frame, as the watch reads them.
      one = prEvents(one, A, pr({ checks: "pending" }), AT);
      one = prEvents(one, B, pr({ checks: "pass" }), AT);
    }
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
    expect(kinds(one).filter((kind) => kind === "pr-opened")).toHaveLength(1);
  });

  it("says WHICH COMMIT a check event is about, so a push reads as one", () => {
    let one = prEvents(work(), A, pr({ checks: "pending" }), AT);
    one = prEvents(one, A, pr({ checks: "pass" }), AT);
    // A push: the same rollup word about a different commit is news.
    one = prEvents(one, A, pr({ checks: "pending", head: PUSHED }), AT);
    expect(kinds(one).filter((kind) => kind.startsWith("checks-"))).toEqual([
      "checks-running",
      "checks-passed",
      "checks-running",
    ]);
    expect(one.events.at(-1)).toMatchObject({ head: PUSHED, pr: 7 });
    // ... and the new commit's checks running is still recorded once, however
    // many members see it.
    expect(prEvents(one, B, pr({ checks: "pending", head: PUSHED }), AT)).toBe(
      one,
    );
  });

  it("hears a reading with NO head once per kind, ever", () => {
    // A host whose padi predates the field says nothing about commits, so
    // there is nothing to tell two readings apart with — and the honest
    // reading of that is one event per kind, not one per frame.
    let one = prEvents(work(), A, pr({ checks: "pending", head: null }), AT);
    one = prEvents(one, B, pr({ checks: "pass", head: null }), AT);
    one = prEvents(one, A, pr({ checks: "pending", head: null }), AT);
    one = prEvents(one, B, pr({ checks: "pass", head: null }), AT);
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
  });

  it("ENDS the work when the PR merges, and when it closes", () => {
    const merged = prEvents(work(), A, pr({ state: "merged" }), AT);
    expect(kinds(merged)).toContain("merged");
    expect(outcomeOf(merged)).toEqual({ kind: "merged", pr: 7 });
    expect(endedAt(merged)).toBe(AT);

    const closed = prEvents(work(), A, pr({ state: "closed" }), AT);
    expect(outcomeOf(closed)).toEqual({ kind: "closed", pr: 7 });
  });

  it("REOPENS the work when the forge says the PR is open again", () => {
    const closed = prEvents(work(), A, pr({ state: "closed" }), AT);
    const again = prEvents(closed, A, pr({ state: "open" }), AT);
    expect(again.state.kind).toBe("open");
    expect(kinds(again)).toContain("reopened");
    // Decisions and timeline whole: this is the same work, and every event
    // the ended one had is still there.
    expect(again.events.length).toBeGreaterThan(closed.events.length);
    // ... and the same reading again is not news: the work is the very value
    // that went in.
    expect(prEvents(again, B, pr({ state: "open" }), AT)).toBe(again);
  });

  it("leaves a work somebody STOPPED stopped, PR open or not", () => {
    const stopped = endWork(prEvents(work(), A, pr(), AT), {
      outcome: { kind: "stopped", by: "you" },
      at: AT,
    });
    expect(prEvents(stopped, A, pr({ state: "open" }), AT)).toBe(stopped);
  });

  it("is about ONE pull request: another number moves nothing", () => {
    // Two members in two worktrees can each report a number. A work has one
    // PR — the one its timeline learned — and alternating between two would
    // be the check ping-pong told about the PR instead of its checks.
    const first = prEvents(work(), A, pr(), AT);
    expect(prEvents(first, B, pr({ number: 9, title: "Other" }), AT)).toBe(
      first,
    );
    expect(prOf(first)?.number).toBe(7);
  });

  // THE PROPERTY: an observation is a question about what the timeline
  // already says, so replaying every reading a work ever had adds nothing.
  // A deterministic sweep rather than a random one — the repo has no
  // fast-check — over every reading two members can make about one PR.
  it("appends NOTHING when the same readings are fed again", () => {
    const checks = ["pending", "pass", "fail", null] as const;
    const heads = [HEAD, PUSHED, null];
    const readings = checks.flatMap((check) =>
      heads.flatMap((head) =>
        [A, B].map((ref) => ({
          ref,
          pr: pr({
            checks: check,
            head,
            failing: check === "fail" ? ["ci"] : [],
          }),
        })),
      ),
    );
    let settled = work();
    for (const one of readings)
      settled = prEvents(settled, one.ref, one.pr, AT);
    const events = settled.events.length;
    // Every reading again, twice, in a different order — the work is the very
    // value that went in.
    for (const one of [...readings].reverse())
      settled = prEvents(settled, one.ref, one.pr, AT);
    for (const one of readings)
      settled = prEvents(settled, one.ref, one.pr, AT);
    expect(settled.events).toHaveLength(events);
  });
});

describe("the files a listing found", () => {
  it("puts every path kolu has not seen before on the timeline, once", () => {
    const first = fileEvents(work(), A, [".waterfall/plan.md"], AT);
    expect(first.events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      terminal: A,
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
      terminal: B,
      path: ".waterfall/plan.md",
    });
    expect(fileEvents(restarted, A, [".waterfall/plan.md"], AT)).toBe(
      restarted,
    );
  });
});
