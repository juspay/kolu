/**
 * WHICH FILES A WORK CAN OPEN — the one rule behind a file the Conductor names
 * in the chat and a `Wrote …` row on the card's timeline.
 */

import { ABOUT_WORK, type Work, type WorkId } from "kolu-work";
import { describe, expect, it } from "vitest";
import { fileHolders, fileTarget, holdsPath } from "./namedFiles";

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
    repoBy: { kind: "git" },
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
  worktree: { kind: "unread" },
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
});

describe("which work's file a named path opens", () => {
  const PARSER = "w-parser" as WorkId;
  const LOGIN = "w-login" as WorkId;
  const SPLIT = "w-split" as WorkId;
  /** The index the chat builds once per change of the works. */
  const works = fileHolders(
    new Map<WorkId, Work>([
      [PARSER, work("rewrite the parser", [PLAN])],
      [LOGIN, work("fix the login", [PLAN, BRIEF])],
      [SPLIT, work("split the column", [])],
    ]),
  );

  it("opens the turn's own work's file, whoever else has one", () => {
    expect(fileTarget(works, [LOGIN], PLAN)).toEqual({
      kind: "open",
      work: LOGIN,
    });
  });

  it("says the turn's work has no such file, rather than offering another's", () => {
    expect(fileTarget(works, [SPLIT], PLAN)).toEqual({
      kind: "missing",
      works: [SPLIT],
    });
  });

  it("offers only the turn's works that hold it, and opens the one that does", () => {
    expect(fileTarget(works, [PARSER, LOGIN, SPLIT], PLAN)).toEqual({
      kind: "choose",
      works: [PARSER, LOGIN],
    });
    expect(fileTarget(works, [PARSER, SPLIT], PLAN)).toEqual({
      kind: "open",
      work: PARSER,
    });
  });

  it("offers every work holding it in a turn about none, and is plain code for a path nobody holds", () => {
    expect(fileTarget(works, [], PLAN)).toEqual({
      kind: "choose",
      works: [PARSER, LOGIN],
    });
    expect(fileTarget(works, [], BRIEF)).toEqual({ kind: "open", work: LOGIN });
    expect(fileTarget(works, [PARSER], "README.md")).toEqual({
      kind: "plain",
    });
  });
});
