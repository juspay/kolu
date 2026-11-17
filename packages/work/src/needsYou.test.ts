/**
 * WHAT NEEDS THE HUMAN, read off records built the way kolu builds them:
 * a question put to them, a hand-over PR going green, a PR the Conductor
 * merges itself going green, and a work that ends. The item's KEY is what the
 * bell rings once for, so the flicker kolu PR #2400 really did — the forge
 * saying can, cannot, can about one commit inside two minutes — must leave
 * the key exactly where it was.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK,
  answerAsk,
  askQuestions,
  endWork,
  type MergeState,
  needsYou,
  needsYouOf,
  openWork,
  type Question,
  recordEvent,
  type Work,
  workIdOf,
} from "./index.ts";

const T0 = Date.UTC(2026, 10, 17, 1, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

const ID = workIdOf({
  kind: "branch",
  host: "local",
  repo: "/home/me/code/kolu",
  branch: "agents-closure-in-cache",
});

/** A full waterfall set up with `on-green` answered as given. */
const setUp = (onGreen: "merge" | "hand-over"): Work => {
  const questions = [
    {
      id: "q-mode",
      topic: "setup",
      key: "mode",
      question: "Which mode?",
      options: ["full", "trivial"],
      given: { kind: "ask" },
    },
    {
      id: "q-green",
      topic: "setup",
      key: "on-green",
      question: "On green?",
      options: ["merge", "hand-over"],
      given: { kind: "ask" },
    },
  ] as const satisfies ReadonlyArray<Question>;
  const opened = openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/home/me/code/kolu",
      branch: "agents-closure-in-cache",
    },
    title: "Published agents fetchable by any host",
    at: at(0),
    request: { kind: "said", text: "waterfall it" },
  });
  return answerAsk(
    askQuestions(opened, { ask: "setup", questions, at: at(1) }),
    {
      ask: "setup",
      at: at(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([
          ["q-mode", ["full"]],
          ["q-green", [onGreen]],
        ]),
      },
    },
  );
};

const prOpened = (work: Work, minute: number): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "pr-opened",
    about: ABOUT_WORK,
    pr: 2402,
    title: "the PR",
    url: { kind: "link", href: "https://github.com/juspay/kolu/pull/2402" },
  });

const passed = (work: Work, minute: number, sha: string): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "ci",
    kind: "checks-passed",
    about: ABOUT_WORK,
    pr: 2402,
    head: { kind: "commit", sha },
    failing: [],
  });

const mergeState = (
  work: Work,
  merge: MergeState,
  minute: number,
  sha: string,
): Work =>
  recordEvent(work, {
    at: at(minute),
    by: "kolu",
    kind: "merge-state",
    about: ABOUT_WORK,
    pr: 2402,
    head: { kind: "commit", sha },
    merge,
  });

const green = (work: Work, minute: number, sha: string): Work =>
  mergeState(passed(work, minute, sha), { kind: "can" }, minute, sha);

const item = (work: Work) => Option.getOrThrow(needsYouOf(ID, work));

describe("what needs the human", () => {
  it("is a question, by its ask, in the question's own words", () => {
    const asked = askQuestions(setUp("hand-over"), {
      ask: "ask-approve",
      questions: [
        {
          id: "q",
          topic: "work",
          question: "May I update master's required checks?",
          header: { kind: "none" },
          options: ["Yes, after a dry run", "No, leave it to me"],
          multiple: false,
          file: { kind: "none" },
        },
      ],
      at: at(30),
    });
    const one = item(asked);
    expect(one.why).toMatchObject({ why: "question", ask: "ask-approve" });
    expect(one.wanted).toBe("May I update master's required checks?");
    expect(one.since).toBe(at(30));
    expect(one.title).toBe("Published agents fetchable by any host");
  });

  it("is a hand-over PR once it goes green, naming the PR and its link", () => {
    const work = prOpened(setUp("hand-over"), 10);
    expect(needsYou([[ID, work]])).toEqual([]);
    const one = item(green(work, 20, "c8897e2"));
    expect(one.wanted).toBe("Merge PR #2402");
    expect(one.since).toBe(at(20));
    expect(one.why).toMatchObject({
      why: "merge",
      pr: Option.some({
        number: 2402,
        head: { kind: "commit", sha: "c8897e2" },
        link: {
          kind: "link",
          href: "https://github.com/juspay/kolu/pull/2402",
        },
      }),
    });
  });

  it("is not a PR the Conductor merges itself (`on-green: merge`)", () => {
    const work = green(prOpened(setUp("merge"), 10), 20, "c8897e2");
    expect(Option.isNone(needsYouOf(ID, work))).toBe(true);
  });

  it("is nothing once the work has ended", () => {
    const work = green(prOpened(setUp("hand-over"), 10), 20, "c8897e2");
    expect(needsYou([[ID, work]])).toHaveLength(1);
    const ended = endWork(work, {
      outcome: { kind: "stopped", by: "you" },
      at: at(40),
    });
    expect(needsYou([[ID, ended]])).toEqual([]);
  });

  it("keeps one key through #2400's flicker, and a new key for a new commit", () => {
    // PR #2400: the forge said can, cannot (blocked), can within two minutes,
    // all about one head. One wait on the human, not two.
    let work = green(prOpened(setUp("hand-over"), 10), 20, "d3f4185");
    const first = item(work).key;
    work = mergeState(work, { kind: "cannot", why: "blocked" }, 21, "d3f4185");
    expect(Option.isNone(needsYouOf(ID, work))).toBe(true);
    work = mergeState(work, { kind: "can" }, 22, "d3f4185");
    expect(item(work).key).toBe(first);
    // A push: the new commit going green is a new thing to merge.
    work = green(work, 30, "69b08e9");
    expect(item(work).key).not.toBe(first);
  });
});
