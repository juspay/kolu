/**
 * THE RECORD'S OWN HOLES, CLOSED.
 *
 * - T19: `recordEvent` takes observations only — an ending or a merge has a
 *   transition of its own — and `prEnded` ends nothing for a work with no PR.
 * - T20: a watch is a watch by its key, whatever its decisions say, and the
 *   store holds nothing in one but its own terminal as `other`.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK,
  askQuestions,
  InvalidWorkStore,
  MODE_RUNS,
  openWork,
  parseStore,
  prEnded,
  recordEvent,
  runOf,
  setupValue,
  type Work,
  type WorkMember,
  watchedRef,
  workIdOf,
} from "./index.ts";

const AT = "2026-11-24T19:00:00.000Z";

const branch = (): Work =>
  openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/repo",
      branch: "csv",
      repoBy: { kind: "git" },
    },
    title: "csv",
    at: AT,
    request: { kind: "none" },
  });

const WATCH_KEY = { kind: "watch", host: "remote:a/b", id: "t1" } as const;
const watch = (): Work =>
  openWork({
    key: WATCH_KEY,
    title: "watch t1",
    at: AT,
    request: { kind: "none" },
  });

describe("recording an event", () => {
  it("takes observations only, and prEnded ends nothing without a PR (T19)", () => {
    const work = branch();
    recordEvent(work, {
      at: AT,
      by: "kolu",
      // @ts-expect-error — an ending is `endWork`'s, never a bare event.
      kind: "ended",
      about: ABOUT_WORK,
      outcome: { kind: "merged", pr: 7 },
    });
    recordEvent(work, {
      at: AT,
      by: "kolu",
      // @ts-expect-error — a merge is `prEnded`'s, which ends the work too.
      kind: "merged",
      about: ABOUT_WORK,
      pr: 7,
    });
    expect(prEnded(work, "merged", AT)).toBe(work);
    expect(prEnded(work, "closed", AT)).toBe(work);
  });
});

describe("a watch", () => {
  it("runs as a watch whatever mode its decisions name (T20)", () => {
    const decided = askQuestions(watch(), {
      ask: "given:w",
      at: AT,
      questions: [
        {
          id: "q-mode",
          question: "Which mode?",
          topic: "setup",
          key: "mode",
          options: ["full"],
          given: { kind: "given", value: "full" },
        },
      ],
    });
    expect(setupValue(decided, "mode")).toEqual(Option.some("full"));
    expect(runOf(decided)).toEqual(
      Option.some({ mode: "watch", ...MODE_RUNS.watch }),
    );
  });

  it("holds its own terminal as `other` and nothing else (T20)", () => {
    const one = watch();
    const id = workIdOf(one.key);
    const works = new Map([[id, one]]);
    const member = (role: WorkMember["role"]): WorkMember => ({
      work: id,
      role,
      joinedAt: AT,
    });
    const own = watchedRef(WATCH_KEY);
    expect(() =>
      parseStore(works, new Map([[own, member("other")]])),
    ).not.toThrow();
    expect(() =>
      parseStore(
        works,
        new Map([
          [own, member("other")],
          ["local/t2", member("other")],
        ]),
      ),
    ).toThrow(InvalidWorkStore);
    expect(() =>
      parseStore(works, new Map([[own, member("planner")]])),
    ).toThrow(InvalidWorkStore);
  });
});
