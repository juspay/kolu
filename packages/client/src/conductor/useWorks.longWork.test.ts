/** ONE WORK WITH A LONG TIMELINE — the length the lane's own works reach.
 *
 *  The per-work split (`perWork`) makes a reading's scope N row memos rather
 *  than N × every leaf of every record, which is what a fleet of works
 *  needs. It says nothing about ONE work: a row that folds the store's
 *  record leaf by leaf subscribes about five nodes an event, so a hundred-
 *  event work puts that single row over `WIDE_SCOPE_DEPS`' 200 on its own —
 *  the finding moved from the whole-collection fold to `<reading>.row`
 *  rather than being removed.
 *
 *  So every row folds the SHARED SNAPSHOT instead (`createWorkRecord`, one
 *  node per event and per decision, read once for the app), and this file is
 *  the proof: a work of 102 events, the three deepest readings (`@` menu,
 *  notes, files) plus the answers, and no diagnostic. The sibling
 *  `useWorks.wideDeps.test.ts` judges the other half — thirty works, each
 *  short.
 *
 *  Equality is against the per-work readings themselves, run over the record
 *  the mirror holds: the readings are what ships, and what this file pins is
 *  the SHAPE of the graph they are read through. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Option } from "effect";
import {
  answerAsk,
  askQuestions,
  type KoluChoiceKey,
  openWork,
  type Question,
  type SentAnswer,
  setupAnswersOf,
  setupMemoryOf,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  workIdOf,
} from "kolu-work";
import { createStore, flush } from "solid-js";
import { expect, it, vi } from "vitest";

const mirror = vi.hoisted(() => ({
  keys: (() => []) as () => WorkId[],
  read: (() => undefined) as (id: WorkId) => Work | undefined,
}));

// The `works` collection, driven from this file; the three mirrors beside it
// in `useWorks.ts` are empty here — every reading judged below is about works.
vi.mock("../wire", () => {
  const empty = { use: () => ({ keys: () => [], byKey: () => undefined }) };
  return {
    app: {
      collections: {
        works: {
          use: () => ({
            keys: () => mirror.keys(),
            byKey: (id: WorkId) => () => mirror.read(id),
          }),
        },
        workMembers: empty,
        memberReadings: empty,
        workPrs: empty,
      },
    },
  };
});

import { workMentionOf } from "./mentionCandidates";
import { pathsOf } from "./namedFiles";
import { notesOfWork } from "./quietChat";
import { joinsOfWork } from "./turnWorks";
import {
  useAgentNotes,
  useFileHolders,
  useJoins,
  useSetupAnswers,
  useWorkMentions,
} from "./useWorks";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** The timeline's length: the lane's own works reach about this, and it is
 *  well past both sides of the threshold — about 510 sources folded off the
 *  store, about 110 off the snapshot, against a limit of 200. */
const EVENTS = 102;

const koluQuestion = (id: string, key: KoluChoiceKey, question: string) =>
  ({ id, topic: "setup", key, question, given: { kind: "ask" } }) as const;

const SETUP = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "How should this run?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
  koluQuestion("q-ph", "planner.harness", "Which harness plans?"),
  koluQuestion("q-pm", "planner.model", "Which model plans?"),
] as const satisfies ReadonlyArray<Question>;

type GrowingWork = Omit<Work, "events"> & { events: WorkEvent[] };

/** An agent step: it moves the timeline, joins nobody, writes no file and
 *  says nothing. */
const stepOf = (minute: number): WorkEvent => ({
  at: at(minute),
  by: "agent",
  kind: minute % 2 === 0 ? "asking" : "ready",
  about: { kind: "member", terminal: `${HOST}/t-0` },
  why: { kind: "none" },
});

/** ONE LONG WORK: a settled setup, terminals that joined, notes, files, and
 *  steps enough to reach {@link EVENTS}. */
const longWork = (): GrowingWork => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: "long-work",
    repoBy: { kind: "git" },
  };
  const answered = answerAsk(
    askQuestions(
      openWork({
        key,
        title: "A work with a long timeline",
        at: at(0),
        request: { kind: "said", text: "do it" },
      }),
      { ask: "setup", questions: SETUP, at: at(1) },
    ),
    {
      ask: "setup",
      at: at(2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map<string, SentAnswer>([
          ["q-mode", ["full"]],
          ["q-ph", ["omp"]],
          ["q-pm", ["anthropic/claude-fable-5"]],
        ]),
      },
    },
  );
  const events: WorkEvent[] = [...answered.events];
  for (let n = 0; events.length < EVENTS; n++) {
    const minute = 10 + n;
    if (n % 8 === 0)
      events.push({
        at: at(minute),
        by: "kolu",
        kind: "joined",
        about: { kind: "member", terminal: `${HOST}/t-${n}` },
        role: "planner",
      });
    else if (n % 8 === 3)
      events.push({
        at: at(minute),
        by: "agent",
        kind: "note",
        about: { kind: "work" },
        text: `Step ${n} is done`,
      });
    else if (n % 8 === 5)
      events.push({
        at: at(minute),
        by: "agent",
        kind: "file",
        about: { kind: "work" },
        path: `/home/code/kolu/long-work/file-${n}.ts`,
      });
    else events.push(stepOf(minute));
  }
  return { ...answered, events };
};

const [works, setWorks] = createStore<Record<string, GrowingWork>>({});
mirror.keys = () => Object.keys(works) as WorkId[];
mirror.read = (id) => works[id];

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

const one = longWork();
const id = workIdOf(one.key);
setWorks((draft) => {
  draft[id] = one;
});

const record = (): Work => {
  const held = works[id];
  if (held === undefined) throw new Error("fixture: the work is not served");
  return held;
};

const answers = useSetupAnswers();
const joins = useJoins();
const notes = useAgentNotes();
const holders = useFileHolders();
const mentions = useWorkMentions();

it("reads a hundred-event work through one snapshot, and says what the folds said", () => {
  flush();
  const held = record();
  expect(held.events.length).toBe(EVENTS);

  expect(raised()).toEqual([]);

  expect(mentions()).toEqual([workMentionOf(id, held)]);
  expect(mentions()[0]?.standing.length).toBeGreaterThan(0);
  expect(notes()).toEqual(notesOfWork(held));
  expect(notes().length).toBeGreaterThan(5);
  expect([
    ...(holders().get(`/home/code/kolu/long-work/file-5.ts`) ?? []),
  ]).toEqual([id]);
  expect(holders().size).toBe(pathsOf(held).size);
  expect([...joins().values()].flat()).toEqual(joinsOfWork(id, held));
  expect(joins().size).toBeGreaterThan(5);
  expect(setupAnswersOf(held).length).toBeGreaterThan(0);
  expect(answers()).toEqual(setupAnswersOf(held));
  expect(
    Option.isSome(setupMemoryOf(answers(), HOST).last("mode", Option.none())),
  ).toBe(true);
});

it("holds every reading when the long timeline moves", () => {
  flush();
  const before = {
    answers: answers(),
    joins: joins(),
    notes: notes(),
    holders: holders(),
    mentions: mentions(),
  };

  // Five steps that say nothing: no reading moves, and no fold re-publishes
  // an equal-but-new container.
  for (let minute = 400; minute < 405; minute++) {
    setWorks((draft) => {
      const held = draft[id];
      if (held === undefined)
        throw new Error("fixture: the work is not served");
      held.events.push(stepOf(minute));
    });
    flush();
  }

  expect(raised()).toEqual([]);
  expect(answers()).toBe(before.answers);
  expect(joins()).toBe(before.joins);
  expect(notes()).toBe(before.notes);
  expect(holders()).toBe(before.holders);
  expect(mentions()).toBe(before.mentions);
});
