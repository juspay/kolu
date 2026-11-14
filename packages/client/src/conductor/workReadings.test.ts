/**
 * THE WORDS THE COLUMN SAYS, pinned without a browser.
 *
 * `kolu-work` already tests what a work IS (who it waits on, the bar, the
 * durations). What is this module's own is the reading a PERSON gets: the
 * sentence under a title, the line beside a timeline dot, and the one number
 * on the tab — which is the only fold here that two surfaces share, so it is
 * the one that must not be re-derived anywhere else.
 */

import {
  type Decision,
  handBack,
  membershipOf,
  takeOver,
  type Work,
  type WorkEvent,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  answerWords,
  checksTally,
  decisionRows,
  eventWords,
  inputAllowed,
  lockCardWords,
  lockWords,
  repoName,
  standingLine,
  waitingCount,
  workSubtitle,
  worksStatusWords,
} from "./workReadings";

const AT = "2026-01-01T10:00:00.000Z";

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  ask: "ask-1",
  at: AT,
  key: null,
  header: "",
  question: "Approve the plan?",
  options: ["Approve", "Ask for changes"],
  multiple: false,
  answer: null,
  ...over,
});

const work = (over: Partial<Work> = {}): Work => ({
  id: "w1",
  title: "Show agent-distro update errors",
  repo: "/home/srid/code/kolu",
  branch: "update-errors",
  members: [
    {
      terminal: "local/a",
      role: "planner",
      joinedAt: AT,
      leftAt: null,
      worktree: null,
    },
  ],
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  endedAt: null,
  outcome: null,
  keptFiles: [],
  ...over,
});

const event = (over: Partial<WorkEvent>): WorkEvent => ({
  at: AT,
  by: "kolu",
  kind: "note",
  terminal: null,
  detail: "",
  ...over,
});

describe("what a card's head says", () => {
  it("names the repo by its last segment, and nothing for a plain watch", () => {
    expect(repoName("/home/srid/code/kolu")).toBe("kolu");
    expect(repoName("/home/srid/code/kolu/")).toBe("kolu");
    expect(repoName("")).toBe("");
  });

  it("drops the parts nobody has answered yet rather than drawing a blank", () => {
    // Setup unanswered: no host, no mode, no PR — the line is the repo alone.
    expect(workSubtitle(work(), null)).toEqual(["kolu"]);
    expect(
      workSubtitle(
        work({
          decisions: [
            decision({ id: "m", key: "mode", answer: answered("trivial") }),
          ],
          events: [event({ kind: "pr-opened", detail: "#178 Slim it" })],
        }),
        "naiveintent",
      ),
    ).toEqual(["kolu", "naiveintent", "trivial", "PR #178"]);
  });
});

function answered(pick: string): NonNullable<Decision["answer"]> {
  return { at: AT, how: "answered", picked: [pick], text: null, from: "chat" };
}

describe("where it stands", () => {
  it("leads with the waiter, and puts the live check tally after CI", () => {
    const ci = work({
      events: [event({ kind: "checks-running", by: "ci" })],
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
      decisions: [decision()],
      events: [event({ kind: "question", by: "agent", detail: "ask-1" })],
    });
    const line = standingLine(asking, null);
    expect(line.who).toBe("you");
    expect(line.lead).toBe("Waiting on you");
    expect(line.what).toBe("Approve the plan?");
  });

  it("names the outcome once it is over", () => {
    // The fold steps through the EVENTS, so a work is over when its timeline
    // says so — `endedAt` is the same instant written down beside them.
    const over = work({
      endedAt: AT,
      outcome: "merged",
      events: [event({ kind: "ended", detail: "merged" })],
    });
    expect(standingLine(over, null)).toMatchObject({
      who: "done",
      lead: "Merged",
      what: "",
    });
  });
});

describe("the timeline's words", () => {
  const asked = work({
    decisions: [
      decision({
        header: "Plan approval",
        answer: { ...answered("Approve"), from: "card" },
      }),
    ],
    members: [
      {
        terminal: "local/a",
        role: "planner",
        joinedAt: AT,
        leftAt: null,
        worktree: null,
      },
    ],
  });

  it("names the decision rather than copying the question's words", () => {
    // THE DEFECT THIS GUARDS: the timeline used to quote the question, so a
    // sentence a person already read on the card was read to them twice.
    expect(
      eventWords(asked, event({ kind: "question", detail: "ask-1" })),
    ).toBe("Asked: Plan approval");
    expect(
      eventWords(asked, event({ kind: "answered", detail: "ask-1" })),
    ).toBe("You: Approve");
  });

  it("names a member by the part it plays", () => {
    expect(
      eventWords(asked, event({ kind: "stopped", terminal: "local/a" })),
    ).toBe("Planner stopped");
    expect(
      eventWords(asked, event({ kind: "file", detail: ".waterfall/plan.md" })),
    ).toBe("Wrote .waterfall/plan.md");
  });

  it("says how an answer ended when nobody gave one", () => {
    expect(answerWords(decision())).toBe("waiting");
    expect(
      answerWords(
        decision({
          answer: {
            at: AT,
            how: "declined",
            picked: [],
            text: null,
            from: null,
          },
        }),
      ),
    ).toBe("declined");
  });
});

describe("the lock, as a person meets it", () => {
  /** A work the Conductor DRIVES — mode answered, one active planner. The
   *  driver is read off the record by `kolu-work`; what is tested here is the
   *  browser's two answers to it: may this person type, and what does the
   *  banner say. */
  const driven = work({
    decisions: [decision({ id: "m", key: "mode", answer: answered("full") })],
  });
  const membershipAt = (one: Work) => {
    const at = membershipOf([one]).get("local/a");
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
      decisions: [
        decision({ id: "m", key: "mode", answer: answered("watch") }),
      ],
    });
    expect(membershipAt(watched).driver).toBe(null);
    expect(lockWords(membershipAt(watched))).toBe("");
  });

  it("tells the timeline what the person did, by the part they took", () => {
    expect(
      eventWords(
        driven,
        event({ kind: "taken-over", by: "you", terminal: "local/a" }),
      ),
    ).toBe("You took over the planner");
    expect(
      eventWords(
        driven,
        event({ kind: "handed-back", by: "you", terminal: "local/a" }),
      ),
    ).toBe("You handed the planner back");
    // The bound's own event: a count, in words, where the stretch happened.
    expect(eventWords(driven, event({ kind: "folded", detail: "42" }))).toBe(
      "42 earlier agent state changes",
    );
  });
});

describe("the decisions, as the rows a card draws", () => {
  const set = work({
    decisions: [
      decision({
        id: "h",
        key: "host",
        answer: answered("remote:naiveintent"),
      }),
      decision({ id: "m", key: "mode", answer: answered("trivial") }),
      decision({
        id: "ih",
        key: "implementor.harness",
        answer: answered("omp"),
      }),
      decision({
        id: "im",
        key: "implementor.model",
        answer: answered("Opus 5.5"),
      }),
      decision({ id: "g", key: "on-green", answer: answered("hand-over") }),
    ],
  });

  it("draws the setup first, one row per label, the host by its name", () => {
    expect(
      decisionRows(set, "naiveintent").map(
        (row) => `${row.label} — ${row.answer}`,
      ),
    ).toEqual([
      // The ref the human picked is never what a person reads.
      "Host — naiveintent",
      "Mode — trivial",
      // ONE row for the role: its harness and its model, not two questions.
      "Implementor — omp · Opus 5.5",
      "On green — hand over",
    ]);
    // Nothing asked: no rows at all.
    expect(decisionRows(work(), null)).toEqual([]);
  });

  it("keeps the question and where it was answered behind the row", () => {
    const row = decisionRows(set, "naiveintent")[0];
    expect(row?.from).toBe("chat");
    expect(row?.decisions.map((one) => one.question)).toEqual([
      "Approve the plan?",
    ]);
  });

  it("labels a question that is not setup by its header, and cuts a long answer", () => {
    const asked = work({
      decisions: [
        decision({
          id: "p",
          header: "Plan approval",
          answer: answered(
            "Change it: the rewrite should keep the reference pages as they are and only touch the guides",
          ),
        }),
      ],
    });
    const row = decisionRows(asked, null)[0];
    expect(row?.label).toBe("Plan approval");
    expect(row?.rest).toBe(true);
    expect(row?.answer.endsWith("…")).toBe(true);
  });
});

describe("the tab's one number", () => {
  const waitingWork = work({
    id: "w2",
    decisions: [decision({ ask: "ask-work" })],
    events: [event({ kind: "question", by: "agent", detail: "ask-work" })],
  });

  it("counts a work waiting on you ONCE, however many questions it holds", () => {
    const two = {
      ...waitingWork,
      decisions: [
        decision({ id: "d1", ask: "ask-work" }),
        decision({ id: "d2", ask: "ask-work" }),
      ],
    };
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
      }),
    ).toBeNull();
    expect(checksTally(null)).toBeNull();
  });
});
