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
import { joinWork, openWork, prOf, recordEvent, type Work } from "kolu-work";
import { fileEvents, prEvents, ringEvent } from "./observing.ts";
import type { WatchPr } from "./observation.ts";

const AT = "2026-02-01T10:00:00.000Z";
const A = "local/aaaa";
const B = "remote:box/bbbb";

const work = (): Work =>
  joinWork(
    openWork({
      id: "w1",
      title: "fix the parser",
      repo: "/srv/repo",
      branch: "fix-the-parser",
      at: AT,
      request: "fix it",
    }),
    { terminal: A, role: "implementor", at: AT },
  );

const pr = (over: Partial<WatchPr> = {}): WatchPr => ({
  number: 7,
  title: "Fix the parser",
  state: "open",
  checks: null,
  failing: [],
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
        detail: "",
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
      detail: "ended without an agent",
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
      detail: "build, lint",
    });
    one = prEvents(one, A, pr({ checks: "pass" }), AT);
    expect(prOf(one)?.checks).toBe("passed");
  });

  it("ENDS the work when the PR merges, and when it closes", () => {
    const merged = prEvents(work(), A, pr({ state: "merged" }), AT);
    expect(kinds(merged)).toContain("merged");
    expect(merged.outcome).toBe("merged");
    expect(merged.endedAt).toBe(AT);

    const closed = prEvents(work(), A, pr({ state: "closed" }), AT);
    expect(closed.outcome).toBe("closed");
  });

  it("records a SECOND PR when the number moves", () => {
    const first = prEvents(work(), A, pr(), AT);
    const second = prEvents(first, A, pr({ number: 9 }), AT);
    expect(kinds(second).filter((kind) => kind === "pr-opened")).toHaveLength(
      2,
    );
    expect(prOf(second)?.number).toBe(9);
  });
});

describe("the files a listing found", () => {
  it("puts every path kolu has not seen before on the timeline, once", () => {
    const first = fileEvents(work(), A, [".waterfall/plan.md"], AT);
    expect(first.events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      terminal: A,
      detail: ".waterfall/plan.md",
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
      detail: ".waterfall/plan.md",
    });
    expect(fileEvents(restarted, A, [".waterfall/plan.md"], AT)).toBe(
      restarted,
    );
  });
});
