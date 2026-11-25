/**
 * A FORM ANSWERED WITH A QUESTION LEFT BLANK — through the one path every
 * face answers by (`asking.answer`), out to the transcript row and the
 * Conductor's wake.
 *
 * The defect this guards: a blank question used to be recorded as answered
 * with nothing, so the setup read it as missing while `work_open` read it as
 * answered, and nothing would ever ask it again. Now a blank question stays
 * asked in the same form, the row says the form is partly answered, and the
 * Conductor is told which questions are settled and which are still open.
 */

import { Option } from "effect";
import type { ConductorWorkAskStanding } from "kolu-common/conductor";
import {
  openWork,
  type Question,
  setupStanding,
  type Work,
  type WorkId,
  workIdOf,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import { asking } from "./asking.ts";
import { type AnsweredNews, wakeText } from "./wakeText.ts";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/srv/repo",
  branch: "fix-the-parser",
  repoBy: "git",
} as const;
const ID: WorkId = workIdOf(KEY);

const SETUP: ReadonlyArray<Question> = [
  {
    id: "q-mode",
    question: "Which mode?",
    topic: "setup",
    key: "mode",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
  {
    id: "q-ih",
    question: "Which harness runs the implementor?",
    topic: "setup",
    key: "implementor.harness",
    given: { kind: "ask" },
  },
  {
    id: "q-im",
    question: "Which model does the implementor run on?",
    topic: "setup",
    key: "implementor.model",
    given: { kind: "ask" },
  },
];

/** `asking` over a work held in a map, with every row move and wake kept. */
const rig = () => {
  const works = new Map<WorkId, Work>([
    [
      ID,
      openWork({
        key: KEY,
        title: "fix the parser",
        at: "2026-02-01T10:00:00.000Z",
        request: { kind: "said", text: "fix the parser" },
      }),
    ],
  ]);
  const rows: Array<ConductorWorkAskStanding> = [];
  const news: Array<AnsweredNews> = [];
  const asks = asking({
    store: {
      get: (id) => Option.fromUndefinedOr(works.get(id)),
      save: (id, work) => {
        works.set(id, work);
      },
      changed: () => {},
    },
    said: () => {},
    settled: (_ask, standing) => {
      rows.push(standing);
    },
    news: (one) => {
      news.push(one);
    },
  });
  const work = (): Work =>
    Option.getOrThrow(Option.fromUndefinedOr(works.get(ID)));
  return { asks, work, rows, news };
};

describe("a form answered with one question left blank", () => {
  it("records what was filled in, keeps the blank one asked, and says which is which", () => {
    const r = rig();
    const { ask } = r.asks.put(ID, "Setting up «fix the parser»", SETUP);

    const outcome = r.asks.answer({
      id: ID,
      work: r.work(),
      ask,
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([
          ["q-mode", ["trivial"]],
          ["q-ih", ["omp"]],
          // The model was left blank: its options never loaded.
          ["q-im", []],
        ]),
      },
    });

    // The reply says the form is only partly answered, and which is open.
    expect(outcome).toEqual({ kind: "part", open: ["q-im"] });
    // The record: two settled with their values, the blank one still asked
    // in the same form — so the one reading says it is open, not answered.
    expect(setupStanding(r.work(), "mode")).toEqual({
      kind: "answered",
      value: "trivial",
    });
    expect(setupStanding(r.work(), "implementor.model")).toEqual({
      kind: "open",
      ask,
    });
    // The row in the chat is still being answered, with what was filled in.
    expect(r.rows.at(-1)).toEqual({
      kind: "part",
      answers: [
        { key: "q-mode", values: ["trivial"] },
        { key: "q-ih", values: ["omp"] },
      ],
    });
    // The Conductor is told what was answered and what is still open.
    const text = wakeText([], () => null, r.news);
    expect(text).toContain("ANSWERED PART");
    expect(text).toContain("mode: trivial");
    expect(text).toContain("implementor.harness: omp");
    expect(text).toMatch(/implementor\.model: STILL OPEN/);
  });

  it("closes the form when the blank question is answered next", () => {
    const r = rig();
    const { ask } = r.asks.put(ID, "Setting up «fix the parser»", SETUP);
    r.asks.answer({
      id: ID,
      work: r.work(),
      ask,
      from: "card",
      reply: {
        kind: "answered",
        values: new Map([
          ["q-mode", ["trivial"]],
          ["q-ih", ["omp"]],
        ]),
      },
    });
    const outcome = r.asks.answer({
      id: ID,
      work: r.work(),
      ask,
      from: "chat",
      reply: {
        kind: "answered",
        values: new Map([["q-im", ["anthropic/claude-fable-5-2"]]]),
      },
    });
    expect(outcome).toEqual({ kind: "answered" });
    expect(r.rows.at(-1)?.kind).toBe("answered");
    expect(wakeText([], () => null, r.news.slice(-1))).not.toContain(
      "STILL OPEN",
    );
  });

  it("moves nothing for a reply with every question blank", () => {
    const r = rig();
    const { ask } = r.asks.put(ID, "Setting up «fix the parser»", SETUP);
    const before = r.work();
    expect(
      r.asks.answer({
        id: ID,
        work: before,
        ask,
        from: "card",
        reply: { kind: "answered", values: new Map([["q-im", [""]]]) },
      }),
    ).toEqual({ kind: "nothing-answered" });
    expect(r.work()).toBe(before);
    expect(r.rows).toEqual([]);
    expect(r.news).toEqual([]);
  });
});
