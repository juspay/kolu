/**
 * THE WORDS THE COLUMN SAYS, pinned without a browser.
 *
 * `kolu-work` already tests what a work IS (who it waits on, the bar, the
 * durations). What is this module's own is the reading a PERSON gets: the
 * sentence under a title, the line beside a timeline dot, and the one number
 * on the tab — which is the only fold here that two surfaces share, so it is
 * the one that must not be re-derived anywhere else.
 */

import type { Decision, Work, WorkEvent } from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  answerWords,
  checksTally,
  eventWords,
  repoName,
  setupWords,
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
    decisions: [decision({ answer: { ...answered("Approve"), from: "card" } })],
    members: [
      { terminal: "local/a", role: "planner", joinedAt: AT, leftAt: null },
    ],
  });

  it("reads an ask through its decision rather than copying the words", () => {
    expect(
      eventWords(asked, event({ kind: "question", detail: "ask-1" })),
    ).toBe("Approve the plan?");
    expect(
      eventWords(asked, event({ kind: "answered", detail: "ask-1" })),
    ).toBe("You answered: Approve");
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

describe("the setup, as one sentence", () => {
  it("states only what has been decided", () => {
    const set = work({
      decisions: [
        decision({ id: "h", key: "host", answer: answered("local") }),
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
    expect(setupWords(set, "naiveintent")).toBe(
      "naiveintent · trivial · implementor omp/Opus 5.5 · on green: hand over",
    );
    // Nothing answered: nothing said.
    expect(setupWords(work(), null)).toBe("");
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
