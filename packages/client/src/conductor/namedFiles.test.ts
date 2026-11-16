/**
 * WHICH FILES A WORK CAN OPEN — the one rule behind a file the Conductor names
 * in the chat and a `Wrote …` row on the card's timeline.
 */

import { ABOUT_WORK, type Work, type WorkId } from "kolu-work";
import { describe, expect, it } from "vitest";
import { holdsPath, worksHolding } from "./namedFiles";

const AT = "2026-11-16T00:00:00.000Z";
const PLAN = ".waterfall/plan.md";
const BRIEF = ".waterfall/brief.md";

/** A work that saw `seen` appear — in progress, or ended keeping `kept`. */
const work = (
  title: string,
  seen: readonly string[],
  kept?: readonly string[],
): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: "/src/app",
    branch: title.replaceAll(" ", "-"),
  },
  title,
  startedAt: AT,
  decisions: [],
  events: seen.map((path) => ({
    at: AT,
    by: "kolu",
    about: ABOUT_WORK,
    kind: "file",
    path,
  })),
  state:
    kept === undefined
      ? { kind: "open" }
      : {
          kind: "ended",
          at: AT,
          outcome: { kind: "stopped", by: "you" },
          kept: kept.map((path) => ({ path, bytes: 1 })),
        },
});

describe("a file a work can open", () => {
  it("is every file a work in progress has seen appear", () => {
    const now = work("parser", [PLAN, BRIEF]);
    expect(holdsPath(now, PLAN)).toBe(true);
    expect(holdsPath(now, BRIEF)).toBe(true);
    expect(holdsPath(now, ".waterfall/review-1.md")).toBe(false);
  });

  it("is, once the work has ended, only what kolu kept", () => {
    // The worktree may be gone: a file it saw but did not keep cannot open.
    const done = work("parser", [PLAN, BRIEF], [PLAN]);
    expect(holdsPath(done, PLAN)).toBe(true);
    expect(holdsPath(done, BRIEF)).toBe(false);
  });

  it("names every work holding a path, by title, and none for a path nobody holds", () => {
    const works = new Map<WorkId, Work>([
      ["w-parser" as WorkId, work("rewrite the parser", [PLAN])],
      ["w-login" as WorkId, work("fix the login", [PLAN, BRIEF])],
    ]);
    expect(worksHolding(works, PLAN)).toEqual([
      { work: "w-parser", title: "rewrite the parser" },
      { work: "w-login", title: "fix the login" },
    ]);
    expect(worksHolding(works, BRIEF)).toEqual([
      { work: "w-login", title: "fix the login" },
    ]);
    expect(worksHolding(works, "README.md")).toEqual([]);
  });
});
