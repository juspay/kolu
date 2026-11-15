/**
 * THE WORDS THE COLUMN SAYS, pinned without a browser.
 *
 * `kolu-work` already tests what a work IS (who it waits on, the bar, the
 * durations). What is this module's own is the reading a PERSON gets: the
 * labels the setup is drawn under, the typography of a one-line row, the
 * sentence under a title, the line beside a timeline dot, and the one number
 * on the tab — which is the only fold here that two surfaces share, so it is
 * the one that must not be re-derived anywhere else.
 */

import {
  type Answered,
  type Asked,
  type Decision,
  type DecisionAnswer,
  handBack,
  membershipOf,
  SETUP_KEYS,
  takeOver,
  type Work,
  type WorkEvent,
  type WorkMember,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  answerWords,
  checksTally,
  decisionLabel,
  decisionRows,
  eventReader,
  inputAllowed,
  LINE_LIMIT,
  lockCardWords,
  lockWords,
  membersIn,
  oneLine,
  outcomeWords,
  repoName,
  SETUP_ROWS,
  standingLine,
  waitingCount,
  workSubtitle,
  worksStatusWords,
} from "./workReadings";

const AT = "2026-01-01T10:00:00.000Z";
const WORK = "branch:local/%2Fhome%2Fsrid%2Fcode%2Fkolu/update-errors";

const asked = (over: Partial<Asked> = {}): Asked => ({
  kind: "asked",
  id: "d1",
  ask: "ask-1",
  at: AT,
  key: null,
  header: "",
  question: "Approve the plan?",
  options: ["Approve", "Ask for changes"],
  multiple: false,
  file: "",
  ...over,
});

function answered(pick: string): DecisionAnswer {
  return { at: AT, how: "answered", picked: [pick], text: null, from: "chat" };
}

/** An answered decision — the other arm of the sum, which is the only way to
 *  carry an answer at all. */
const settled = (
  answer: DecisionAnswer,
  over: Partial<Asked> = {},
): Answered => ({ ...asked(over), kind: "answered", answer });

const work = (over: Partial<Work> = {}): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: "/home/srid/code/kolu",
    branch: "update-errors",
  },
  title: "Show agent-distro update errors",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  ...over,
});

/** The ONE members map, as the wire hands it over: terminal to its membership
 *  of a work. */
const members = (
  role: WorkMember["role"] = "planner",
  terminal = "local/a",
): ReadonlyMap<string, WorkMember> =>
  new Map([[terminal, { work: WORK, role, joinedAt: AT, worktree: null }]]);

const event = (over: Partial<WorkEvent> & Pick<WorkEvent, "kind">): WorkEvent =>
  ({
    at: AT,
    by: "kolu",
    terminal: null,
    ...over,
  }) as WorkEvent;

/** A member joined, as the TIMELINE says it — which is where a role is read
 *  from, so a terminal that has since left is still named by its part. */
const joined = (terminal = "local/a", role: WorkMember["role"] = "planner") =>
  event({ kind: "joined", terminal, role });

const words = (one: Work, of: WorkEvent): string => eventReader(one)(of);

describe("what a card's head says", () => {
  it("names the repo by its last segment, and nothing for a plain watch", () => {
    expect(repoName("/home/srid/code/kolu")).toBe("kolu");
    expect(repoName("/home/srid/code/kolu/")).toBe("kolu");
    expect(repoName("")).toBe("");
  });

  it("says where the work IS — the repo and the branch of its key", () => {
    // Setup unanswered: no mode, no PR — the line is the identity alone.
    expect(workSubtitle(work(), null)).toEqual(["kolu", "update-errors"]);
    expect(
      workSubtitle(
        work({
          decisions: [settled(answered("trivial"), { id: "m", key: "mode" })],
          events: [
            event({ kind: "pr-opened", pr: 178, title: "Slim it", by: "kolu" }),
          ],
        }),
        "naiveintent",
      ),
    ).toEqual(["kolu", "update-errors", "naiveintent", "trivial", "PR #178"]);
  });

  it("says a watch is a watch, which has no repo to name", () => {
    expect(
      workSubtitle(
        work({ key: { kind: "watch", terminal: "local/a" } }),
        "naiveintent",
      ),
    ).toEqual(["watching", "naiveintent"]);
  });
});

describe("where it stands", () => {
  it("leads with the waiter, and puts the live check tally after CI", () => {
    const ci = work({
      events: [
        event({
          kind: "checks-running",
          by: "ci",
          pr: 7,
          head: null,
          failing: [],
        }),
      ],
    });
    const line = standingLine(ci, {
      pass: 14,
      pending: 9,
      fail: 0,
      total: 23,
    });
    expect(line.who).toBe("ci");
    expect(line.lead).toBe("CI running");
    // 14 landed of 23 — the one number the record cannot hold, because it is
    // only true for the instant it was read.
    expect(line.what).toBe("14 of 23 checks");
  });

  it("says the question itself while it waits on you", () => {
    const asking = work({
      decisions: [asked()],
      events: [event({ kind: "question", by: "agent", ask: "ask-1" })],
    });
    const line = standingLine(asking, null);
    expect(line.who).toBe("you");
    expect(line.lead).toBe("Waiting on you");
    expect(line.what).toBe("Approve the plan?");
  });

  it("names the outcome once it is over — and there is no 'abandoned'", () => {
    const outcome = { kind: "merged", pr: 7 } as const;
    const over = work({
      state: { kind: "ended", at: AT, outcome, kept: [] },
      events: [event({ kind: "ended", outcome })],
    });
    expect(standingLine(over, null)).toMatchObject({
      who: "done",
      lead: "Merged",
      what: "Merged #7",
    });
  });

  it("says WHO stopped a work that somebody stopped", () => {
    expect(outcomeWords({ kind: "stopped", by: "you" })).toBe("Stopped by you");
    expect(outcomeWords({ kind: "stopped", by: "conductor" })).toBe(
      "Stopped by the Conductor",
    );
    expect(outcomeWords({ kind: "closed", pr: 12 })).toBe("Closed #12");
  });
});

describe("the members of one work", () => {
  it("reads them out of the ONE map, in the order a waterfall runs them", () => {
    const map = new Map<string, WorkMember>([
      [
        "local/b",
        { work: WORK, role: "implementor", joinedAt: AT, worktree: null },
      ],
      [
        "local/a",
        { work: WORK, role: "planner", joinedAt: AT, worktree: null },
      ],
      [
        "local/c",
        {
          work: "branch:local/x/y",
          role: "other",
          joinedAt: AT,
          worktree: null,
        },
      ],
    ]);
    expect(membersIn(map, WORK).map((one) => one.terminal)).toEqual([
      "local/a",
      "local/b",
    ]);
  });

  it("answers the empty list for a work nothing is a member of", () => {
    expect(membersIn(new Map(), WORK)).toEqual([]);
  });
});

describe("the timeline's words", () => {
  const plan = work({
    decisions: [
      settled(
        { ...answered("Approve"), from: "card" },
        {
          header: "Plan approval",
        },
      ),
    ],
    events: [joined()],
  });

  it("names the decision rather than copying the question's words", () => {
    // THE DEFECT THIS GUARDS: the timeline used to quote the question, so a
    // sentence a person already read on the card was read to them twice.
    expect(words(plan, event({ kind: "question", ask: "ask-1" }))).toBe(
      "Asked: Plan approval",
    );
    expect(words(plan, event({ kind: "answered", ask: "ask-1" }))).toBe(
      "You: Approve",
    );
  });

  it("never draws an ask id, not even for a question nobody can find", () => {
    const orphan = { kind: "question", ask: "ask:29b0c4f1:1" } as const;
    for (const kind of ["question", "answered", "question-dropped"] as const)
      expect(words(plan, event({ ...orphan, kind }))).not.toContain("ask:");
    expect(words(plan, event(orphan))).toBe("Asked: something");
  });

  it("says which commit a check event is about once there are two", () => {
    const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";
    const PUSHED = "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5";
    const check = (
      kind: "checks-running" | "checks-passed" | "checks-failed",
      head: string,
      failing: string[] = [],
    ) => event({ kind, by: "ci", pr: 7, head, failing });
    // One commit: the oid is on the record, and saying it would be the
    // card's loudest word for its least interesting fact.
    const one = work({
      events: [check("checks-running", HEAD), check("checks-passed", HEAD)],
    });
    expect(words(one, one.events[0] as WorkEvent)).toBe("CI running");
    // A push: now the two runs have to be told apart.
    const pushed = work({
      events: [
        ...one.events,
        check("checks-running", PUSHED),
        check("checks-failed", PUSHED, ["ci::biome", "ci::unit"]),
      ],
    });
    expect(words(pushed, pushed.events[0] as WorkEvent)).toBe(
      "CI running · 4f21a9c",
    );
    expect(words(pushed, pushed.events[1] as WorkEvent)).toBe(
      "Checks passed · 4f21a9c",
    );
    expect(words(pushed, pushed.events[3] as WorkEvent)).toBe(
      "Checks failed · ci::biome, ci::unit · 9b7e3d1",
    );
  });

  it("draws a check event whose reading named no commit", () => {
    const old = work({
      events: [
        event({
          kind: "checks-failed",
          by: "ci",
          pr: 7,
          head: null,
          failing: ["build"],
        }),
      ],
    });
    expect(words(old, old.events[0] as WorkEvent)).toBe(
      "Checks failed · build",
    );
  });

  it("names a member by the part it played, even after it left", () => {
    expect(
      words(plan, event({ kind: "stopped", terminal: "local/a", why: "" })),
    ).toBe("Planner stopped");
    expect(
      words(plan, event({ kind: "left", terminal: "local/a", why: "gone" })),
    ).toBe("Planner left · its terminal is gone");
    expect(
      words(plan, event({ kind: "file", path: ".waterfall/plan.md" })),
    ).toBe("Wrote .waterfall/plan.md");
  });

  it("says the end and the way back in the words there are only four of", () => {
    expect(
      words(
        plan,
        event({ kind: "ended", outcome: { kind: "stopped", by: "you" } }),
      ),
    ).toBe("Stopped by you");
    expect(words(plan, event({ kind: "reopened" }))).toBe("Opened again");
  });

  it("says how an answer ended when nobody gave one", () => {
    expect(answerWords(asked())).toBe("waiting");
    expect(
      answerWords(
        settled({
          at: AT,
          how: "declined",
          picked: [],
          text: null,
          from: "card",
        }),
      ),
    ).toBe("declined");
  });
});

describe("the lock, as a person meets it", () => {
  /** A work the Conductor DRIVES — mode answered, one planner in the members
   *  map. The driver is read off the record by `kolu-work`; what is tested
   *  here is the browser's two answers to it: may this person type, and what
   *  does the banner say. */
  const driven = work({
    decisions: [settled(answered("full"), { id: "m", key: "mode" })],
    events: [joined()],
  });
  const membershipAt = (one: Work) => {
    const at = membershipOf(new Map([[WORK, one]]), members()).get("local/a");
    if (at === undefined) throw new Error("the planner must be a member");
    return at;
  };

  it("blocks a person's input only while the Conductor is driving", () => {
    // The four cases every input site passes through this one rule.
    expect(inputAllowed("conductor")).toBe(false);
    expect(inputAllowed("you")).toBe(true);
    expect(inputAllowed(null)).toBe(true);
    expect(inputAllowed(undefined)).toBe(true);
  });

  it("says who is driving, which part and which work", () => {
    expect(lockWords(membershipAt(driven))).toBe(
      "Driven by the Conductor · Planner · Show agent-distro update errors",
    );
    // Taken over: the SAME index, read after the act — so the banner, the
    // dock's mark and the keystroke gate cannot disagree.
    const mine = takeOver(driven, "local/a", AT);
    expect(lockWords(membershipAt(mine))).toBe(
      "Taken over · Planner · Show agent-distro update errors",
    );
    expect(inputAllowed(membershipAt(mine).driver)).toBe(true);
    expect(
      inputAllowed(membershipAt(handBack(mine, "local/a", AT)).driver),
    ).toBe(false);
  });

  it("names the Conductor and the part on the card typing raises", () => {
    // ONE LINE, and no work title in it: the card is centred over the very
    // terminal it is about, so the words say who holds the keyboard and what
    // this terminal is for, and nothing a reader can already see.
    expect(lockCardWords(membershipAt(driven))).toBe(
      "The Conductor is driving this terminal · Planner",
    );
  });

  it("draws nothing for a work that drives nothing — a watch", () => {
    const watched = work({
      decisions: [settled(answered("watch"), { id: "m", key: "mode" })],
      events: [joined()],
    });
    expect(membershipAt(watched).driver).toBe(null);
    expect(lockWords(membershipAt(watched))).toBe("");
  });

  it("tells the timeline what the person did, by the part they took", () => {
    expect(
      words(
        driven,
        event({ kind: "taken-over", by: "you", terminal: "local/a" }),
      ),
    ).toBe("You took over the planner");
    expect(
      words(
        driven,
        event({ kind: "handed-back", by: "you", terminal: "local/a" }),
      ),
    ).toBe("You handed the planner back");
    // The bound's own event: a count, in words, where the stretch happened.
    expect(words(driven, event({ kind: "folded", count: 42 }))).toBe(
      "42 earlier agent state changes",
    );
  });
});

describe("the card's own vocabulary and typography", () => {
  it("labels a setup decision by its key's own name, one label per role", () => {
    expect(decisionLabel(asked({ key: "mode" }))).toBe("Mode");
    expect(decisionLabel(asked({ key: "on-green" }))).toBe("On green");
    // A role is ONE row: its harness and its model answer under one label.
    expect(decisionLabel(asked({ key: "planner.harness" }))).toBe("Planner");
    expect(decisionLabel(asked({ key: "planner.model" }))).toBe("Planner");
    expect(decisionLabel(asked({ key: "implementor.model" }))).toBe(
      "Implementor",
    );
    // Every key has a row, and no key has two. The HOST is not among them:
    // a work IS its host, so there is nothing there to decide.
    expect([...SETUP_ROWS].flat().sort()).toEqual([...SETUP_KEYS].sort());
  });

  it("labels any other decision by its header", () => {
    expect(decisionLabel(asked({ header: "Plan approval" }))).toBe(
      "Plan approval",
    );
  });

  it("falls back to a few words of the question when there is no header", () => {
    expect(decisionLabel(asked())).toBe("Approve the plan?");
    // THE DEFECT THIS GUARDS: a Conductor that reasons inside its question
    // had that whole paragraph drawn as the row's label.
    expect(
      decisionLabel(
        asked({
          question:
            "Full or trivial? I'd pick full: a docs rewrite has choices of scope and voice worth seeing in a plan.",
        }),
      ),
    ).toBe("Full or trivial? I'd pick full: a…");
  });

  it("cuts a line at a word, says there is more, and leaves a short one alone", () => {
    expect(oneLine("Checks passed")).toEqual({
      line: "Checks passed",
      rest: false,
    });
    const whole =
      "Which host should this run on? ~/code/odu is a different checkout on each machine, so it matters";
    const long = oneLine(whole);
    expect(long.rest).toBe(true);
    expect(long.line.endsWith("…")).toBe(true);
    expect(long.line.length).toBeLessThanOrEqual(LINE_LIMIT + 1);
    expect(whole.startsWith(long.line.slice(0, -1))).toBe(true);
  });

  it("flattens line breaks into the one line, and says the rest is behind it", () => {
    expect(oneLine("Opened #7\nRewrite the parser")).toEqual({
      line: "Opened #7 Rewrite the parser",
      rest: true,
    });
  });
});

describe("the decisions, as the rows a card draws", () => {
  const set = work({
    decisions: [
      settled(answered("trivial"), { id: "m", key: "mode" }),
      settled(answered("omp"), { id: "ih", key: "implementor.harness" }),
      settled(answered("Opus 5.5"), { id: "im", key: "implementor.model" }),
      settled(answered("hand-over"), { id: "g", key: "on-green" }),
    ],
  });

  it("draws the setup first, one row per label", () => {
    expect(
      decisionRows(set).map((row) => `${row.label} — ${row.answer}`),
    ).toEqual([
      "Mode — trivial",
      // ONE row for the role: its harness and its model, not two questions.
      "Implementor — omp · Opus 5.5",
      "On green — hand over",
    ]);
    // Nothing asked: no rows at all.
    expect(decisionRows(work())).toEqual([]);
  });

  it("keeps the question and where it was answered behind the row", () => {
    const row = decisionRows(set)[0];
    expect(row?.from).toBe("chat");
    expect(row?.decisions.map((one) => one.question)).toEqual([
      "Approve the plan?",
    ]);
  });

  it("labels a question that is not setup by its header, and cuts a long answer", () => {
    const long = work({
      decisions: [
        settled(
          answered(
            "Change it: the rewrite should keep the reference pages as they are and only touch the guides",
          ),
          { id: "p", header: "Plan approval" },
        ),
      ],
    });
    const row = decisionRows(long)[0];
    expect(row?.label).toBe("Plan approval");
    expect(row?.rest).toBe(true);
    expect(row?.answer.endsWith("…")).toBe(true);
  });
});

describe("the tab's one number", () => {
  const waitingWork = work({
    decisions: [asked({ ask: "ask-work" })],
    events: [event({ kind: "question", by: "agent", ask: "ask-work" })],
  });

  it("counts a work waiting on you ONCE, however many questions it holds", () => {
    const two = work({
      decisions: [
        asked({ id: "d1", ask: "ask-work" }),
        asked({ id: "d2", ask: "ask-work" }),
      ],
      events: waitingWork.events,
    });
    expect(waitingCount([two], ["ask-work"])).toBe(1);
  });

  it("adds a question that belongs to no work, and never double-counts one that does", () => {
    // `ask-work` is the work's own — already counted by the work. `ask-chat`
    // is the conversation's alone and has no card to carry it.
    expect(waitingCount([waitingWork], ["ask-work", "ask-chat"])).toBe(2);
    expect(waitingCount([], ["ask-chat"])).toBe(1);
    expect(waitingCount([work()], [])).toBe(0);
  });

  it("leaves a part that would read zero out of the status line", () => {
    expect(worksStatusWords([work()], [])).toBe("1 piece of work");
    expect(worksStatusWords([], ["ask-chat"])).toBe("1 waiting on you");
    expect(worksStatusWords([], [])).toBe("");
    // An ENDED work is not in flight, so it is not counted as a piece of work.
    expect(
      worksStatusWords(
        [
          work({
            state: {
              kind: "ended",
              at: AT,
              outcome: { kind: "stopped", by: "you" },
              kept: [],
            },
          }),
        ],
        [],
      ),
    ).toBe("");
  });
});

describe("a PR's checks", () => {
  it("says nothing at all when no checks are configured", () => {
    expect(
      checksTally({
        number: 1,
        title: "t",
        url: "u",
        state: "open",
        checks: null,
        checkRuns: [],
        reviewDecision: null,
        mergeStateStatus: "UNKNOWN",
        headSha: null,
      }),
    ).toBeNull();
    expect(checksTally(null)).toBeNull();
  });
});

/** The sum's two arms, as the card reads them — a compile-time claim as much
 *  as a runtime one: an ended work has no `members` and no open asks to draw,
 *  because the ended arm of {@link Decision}'s neighbour has nowhere to put
 *  them. */
describe("a finished card has nothing to draw terminals or questions from", () => {
  it("has no members in the one map once the work has ended", () => {
    // Ending removes a work's members in the same step, so the map simply has
    // no row pointing at it.
    expect(membersIn(new Map(), WORK)).toEqual([]);
  });

  it("keeps its decisions and its timeline across the end", () => {
    const decided: ReadonlyArray<Decision> = [
      settled(answered("hand-over"), { id: "g", key: "on-green" }),
    ];
    const over = work({
      decisions: [...decided],
      state: {
        kind: "ended",
        at: AT,
        outcome: { kind: "stopped", by: "you" },
        kept: [],
      },
      events: [
        joined(),
        event({ kind: "ended", outcome: { kind: "stopped", by: "you" } }),
        event({ kind: "reopened" }),
      ],
    });
    expect(decisionRows(over).map((row) => row.label)).toEqual(["On green"]);
    expect(over.events.map((one) => words(over, one))).toEqual([
      "Planner joined",
      "Stopped by you",
      "Opened again",
    ]);
  });
});
