import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  dropAsk,
  dropQuestions,
  endWork,
  keysToAsk,
  koluKeysOf,
  needsSetupKey,
  type OnGreen,
  openAsks,
  openSetupQuestions,
  openWork,
  policyOf,
  type Question,
  reopenWork,
  SETUP_KEYS,
  type SetupKey,
  setupOf,
  setupStanding,
  setupValue,
  startBlockers,
  answerAsk,
  askQuestions,
  type Work,
  type WorkMode,
  unneededSetupQuestions,
  waitingOn,
} from "./index.ts";
import { seeded as random } from "../test/seeded.ts";

const at = (step: number): string =>
  new Date(Date.UTC(2026, 10, 15, 9, 0, step)).toISOString();

const MODES: ReadonlyArray<WorkMode> = ["full", "trivial"];
const ON_GREEN_WORDS: ReadonlyArray<OnGreen> = ["merge", "hand-over"];

const questionFor = (key: SetupKey, id: string): Question => {
  switch (key) {
    case "mode":
      return {
        id,
        question: "Which mode?",
        topic: "setup",
        key,
        options: MODES,
        given: { kind: "ask" },
      };
    case "on-green":
      return {
        id,
        question: "On green?",
        topic: "setup",
        key,
        options: ON_GREEN_WORDS,
        given: { kind: "ask" },
      };
    default:
      return {
        id,
        question: `${key}?`,
        topic: "setup",
        key,
        given: { kind: "ask" },
      };
  }
};

const valueFor = (key: SetupKey, pick: () => number): string => {
  switch (key) {
    case "mode":
      return pick() < 0.5 ? "full" : "trivial";
    case "on-green":
      return pick() < 0.5 ? "merge" : "hand-over";
    default:
      return key.endsWith(".harness") ? "omp" : "anthropic/claude-fable-5-2";
  }
};

const workOpen = (
  work: Option.Option<Work>,
  step: number,
  ids: () => string,
): Work => {
  const was = Option.match(work, {
    onNone: () =>
      openWork({
        key: { kind: "branch", host: "local", repo: "/r", branch: "b" },
        title: "walk",
        at: at(step),
        request: { kind: "said", text: "waterfall it" },
      }),
    onSome: (one) => reopenWork(one, at(step)),
  });
  const keys = keysToAsk(Option.some(was), SETUP_KEYS, new Set());
  if (keys.length === 0) return was;
  const cleared = dropQuestions(was, openSetupQuestions(was, keys), at(step));
  return askQuestions(cleared, {
    ask: `ask-${step}`,
    questions: keys.map((key) => questionFor(key, ids())),
    at: at(step),
  });
};

const agree = (work: Work, seed: number, step: number): void => {
  const where = `seed ${seed}, step ${step}`;
  for (const key of SETUP_KEYS) {
    const missing =
      needsSetupKey(work, key) && Option.isNone(setupValue(work, key));
    const asks = keysToAsk(Option.some(work), [key], new Set()).length > 0;
    expect(asks, `${where}: work_open asks ${key}`).toBe(missing);
    for (const role of ["planner", "implementor"] as const) {
      if (key !== "mode" && !koluKeysOf(role).some((one) => one === key))
        continue;
      const refuses = startBlockers(work, role).some((one) => one.key === key);
      expect(refuses, `${where}: starting ${role} refuses for ${key}`).toBe(
        missing,
      );
    }
    const standing = setupStanding(work, key);
    if (standing.kind === "open") {
      expect(openAsks(work), `${where}: ${key} is open on the card`).toContain(
        standing.ask,
      );
      expect(needsSetupKey(work, key), `${where}: ${key} open but moot`).toBe(
        true,
      );
    }
  }
  const setup = setupOf(work);
  expect(Option.getOrUndefined(setup.mode)).toBe(
    Option.getOrUndefined(setupValue(work, "mode")),
  );
  expect(
    waitingOn(work, policyOf(work)) === "you",
    `${where}: the fold waits on you exactly while a question is open`,
  ).toBe(work.state.kind === "open" && openAsks(work).length > 0);
};

const walk = (seed: number, steps: number): void => {
  const pick = random(seed);
  let next = 0;
  const ids = (): string => `q-${(next += 1)}`;
  let work = workOpen(Option.none(), 0, ids);
  agree(work, seed, 0);
  for (let step = 1; step <= steps; step += 1) {
    const roll = pick();
    const open = openAsks(work);
    const ask = open[Math.floor(pick() * open.length)];
    if (roll < 0.45 && ask !== undefined) {
      const values = new Map<string, ReadonlyArray<string>>();
      for (const one of work.decisions)
        if (one.ask === ask && one.kind === "asked" && one.topic === "setup")
          if (pick() < 0.6) values.set(one.id, [valueFor(one.key, pick)]);
      const recorded = answerAsk(work, {
        ask,
        at: at(step),
        from: "card",
        reply: { kind: "answered", values },
      });
      work = dropQuestions(
        recorded,
        unneededSetupQuestions(recorded),
        at(step),
      );
    } else if (roll < 0.55 && ask !== undefined) {
      work = answerAsk(work, {
        ask,
        at: at(step),
        from: "chat",
        reply: { kind: "declined" },
      });
    } else if (roll < 0.65 && work.state.kind === "open") {
      work = endWork(
        openAsks(work).reduce(
          (one, each) => dropAsk(one, each, at(step)),
          work,
        ),
        { outcome: { kind: "stopped", by: "you" }, at: at(step) },
      );
    } else if (roll < 0.72) {
      work = reopenWork(work, at(step));
    } else {
      work = workOpen(Option.some(work), step, ids);
    }
    agree(work, seed, step);
  }
};

describe("one reading of a setup question, whoever reads it", () => {
  it.each(
    Array.from({ length: 200 }, (_, at) => at + 1),
  )("agrees at every step of walk %i", (seed) => walk(seed, 40));
});
