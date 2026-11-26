/** THE WHOLE-WORKS FOLDS EVERY FACE USED TO DO FOR ITSELF — the setup memory
 *  a question opens on, the joins a chat turn is read through, the notes a
 *  folded turn says, which work holds which file, the `@` menu's rows and the
 *  board's two halves. Five readings of ONE collection, each of which used to
 *  walk every leaf of every record inside a per-face memo.
 *
 *  Two properties, both of which Solid's development build judges:
 *
 *   - a fold must not put every record's leaves on ONE scope. A fleet of
 *     works read whole subscribes a single memo to every decision, every
 *     event and every leaf under them — `WIDE_SCOPE_DEPS` at 200 sources,
 *     and the setup memory, which walks each work's decisions once per
 *     answer, crosses `HUGE_FAN_IN`'s 2000 as well. Read work by work, a
 *     scope is one record's leaves and the join is N entries;
 *   - a publish that moves ONE work must not re-publish the others' readings.
 *     A fold minting a fresh container per run has an equality gate that
 *     never closes, so every reader re-runs on every timeline tick —
 *     `UNSTABLE_MEMO_OUTPUT`, raised on the fourth equal-but-new value.
 *
 *  Both are asserted on the diagnostics Solid raised AND on the values: the
 *  readings are compared against the whole-collection folds they replace, so
 *  a narrower graph that answers a different thing is no fix. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Option } from "effect";
import {
  answerAsk,
  askQuestions,
  finished,
  inProgress,
  type KoluChoiceKey,
  openWork,
  type Question,
  type SentAnswer,
  setupAnswersOf,
  type SetupMemory,
  setupMemoryOf,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  type WorkRow,
  workIdOf,
} from "kolu-work";
import { createStore, flush } from "solid-js";
import { expect, it, vi } from "vitest";

const mirror = vi.hoisted(() => ({
  /** The ids the collection serves, read reactively off the store below. */
  keys: (() => []) as () => WorkId[],
  /** One work, likewise — the per-key accessor the mirror hands out. */
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

import { workMentionCandidates, workMentionOf } from "./mentionCandidates";
import { type FileHolders, mergeHolders, pathsOf } from "./namedFiles";
import { mergeNotes, notesOfWork, type WorkNote } from "./quietChat";
import { type Joins, joinsOfWork, mergeJoins } from "./turnWorks";
import {
  useAgentNotes,
  useFileHolders,
  useJoins,
  useSetupAnswers,
  useWorkMentions,
  useWorkSplit,
} from "./useWorks";

/** THE WHOLE-COLLECTION FOLDS, as the app composes them from the per-work
 *  readings that ship (`useJoins`, `useAgentNotes`, `useFileHolders`,
 *  `useSetupAnswers`): each work read once, the answers joined. They are the
 *  oracle every reading below is compared against, and they live here
 *  because nothing in the product walks a collection of works any more. */
const joinsOf = (works: ReadonlyMap<WorkId, Work>): Joins =>
  mergeJoins([...works].map(([id, record]) => joinsOfWork(id, record)));

const agentNotes = (
  works: ReadonlyMap<WorkId, Work>,
): ReadonlyArray<WorkNote> => mergeNotes([...works.values()].map(notesOfWork));

const fileHolders = (works: ReadonlyMap<WorkId, Work>): FileHolders =>
  mergeHolders([...works].map(([id, one]) => [id, pathsOf(one)] as const));

const setupMemory = (works: ReadonlyArray<Work>, host: string): SetupMemory =>
  setupMemoryOf(works.flatMap(setupAnswersOf), host);

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET. Thirty works, each carrying one answered setup — enough that
 *  the memory read whole crosses `HUGE_FAN_IN`'s 2000 sources (each answer
 *  walks its work's decisions again for the harness its role ran on), while
 *  ONE work's own answers are well under `WIDE_SCOPE_DEPS`' 200. */
const WORKS = 30;

const koluQuestion = (id: string, key: KoluChoiceKey, question: string) =>
  ({ id, topic: "setup", key, question, given: { kind: "ask" } }) as const;

const SETUP = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
  koluQuestion("q-ph", "planner.harness", "Planner harness?"),
  koluQuestion("q-pm", "planner.model", "Planner model?"),
  koluQuestion("q-ih", "implementor.harness", "Implementor harness?"),
  koluQuestion("q-im", "implementor.model", "Implementor model?"),
  {
    id: "q-green",
    topic: "setup",
    key: "on-green",
    question: "On green?",
    options: ["merge", "hand-over"],
    given: { kind: "ask" },
  },
] as const satisfies ReadonlyArray<Question>;

/** The work as this file grows it: one timeline it appends to in place, so a
 *  publish is a LEAF write the way a server frame is, and not a record
 *  replaced wholesale. */
type GrowingWork = Omit<Work, "events"> & { events: WorkEvent[] };

const [works, setWorks] = createStore<Record<string, GrowingWork>>({});
mirror.keys = () => Object.keys(works) as WorkId[];
mirror.read = (id) => works[id];

/** An agent step: it moves the timeline, joins nobody, writes no file and
 *  says nothing — no reading judged here is about it. */
const stepOf = (minute: number): WorkEvent => ({
  at: at(minute),
  by: "agent",
  kind: minute % 2 === 0 ? "asking" : "ready",
  about: { kind: "member", terminal: `${HOST}/t-0` },
  why: { kind: "none" },
});

/** ONE WORK, as the mirror carries it: a settled setup, a terminal that
 *  joined it, a note the Conductor wrote on it and a file it has seen. */
const workOf = (n: number): GrowingWork => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: `work-${n}`,
    repoBy: { kind: "git" },
  };
  const opened = openWork({
    key,
    title: `Work number ${n}`,
    at: at(n),
    request: { kind: "said", text: "do it" },
  });
  const answered = answerAsk(
    askQuestions(opened, { ask: "setup", questions: SETUP, at: at(n + 1) }),
    {
      ask: "setup",
      at: at(n + 2),
      from: "card",
      reply: {
        kind: "answered",
        values: new Map<string, SentAnswer>([
          ["q-mode", ["full"]],
          ["q-ph", ["omp"]],
          ["q-pm", [`anthropic/claude-fable-5-${n % 4}`]],
          ["q-ih", ["claude"]],
          ["q-im", [`claude-opus-4-${n % 3}`]],
          ["q-green", [n % 2 === 0 ? "merge" : "hand-over"]],
        ]),
      },
    },
  );
  return {
    ...answered,
    events: [
      ...answered.events,
      {
        at: at(n + 3),
        by: "kolu",
        kind: "joined",
        about: { kind: "member", terminal: `${HOST}/t-${n}` },
        role: "planner",
      },
      {
        at: at(n + 4),
        by: "agent",
        kind: "note",
        about: { kind: "work" },
        text: `Work ${n} is under way`,
      },
      {
        at: at(n + 5),
        by: "agent",
        kind: "file",
        about: { kind: "work" },
        path: `/home/code/kolu/work-${n}/plan.md`,
      },
      stepOf(n + 6),
    ],
  };
};

/** Put a work in the mirror, as its own key. */
const serve = (work: GrowingWork): WorkId => {
  const id = workIdOf(work.key);
  setWorks((draft) => {
    draft[id] = work;
  });
  return id;
};

/** One timeline tick, as the server would deliver it: an event appended to a
 *  work already in the mirror. */
const tick = (id: WorkId, minute: number): void => {
  setWorks((draft) => {
    const one = draft[id];
    if (one === undefined) throw new Error(`fixture: ${id} is not served`);
    one.events.push(stepOf(minute));
  });
  flush();
};

/** The mirror as a whole-collection fold takes it — what the oracles above
 *  (`setupMemory`, `joinsOf`, `agentNotes`, `fileHolders`) are handed. */
const whole = (): ReadonlyMap<WorkId, Work> =>
  new Map(Object.entries(works) as Array<[WorkId, Work]>);

/** The works in the order every reader draws them, which is `useWorks`': in
 *  progress oldest first, then the finished ones. */
const rowsOf = (): ReadonlyArray<WorkRow> => {
  const pairs = [...whole()].sort(([, a], [, b]) =>
    a.startedAt < b.startedAt ? -1 : 1,
  );
  return [...inProgress(pairs), ...finished(pairs)];
};

/** The codes Solid raised, taken off the collector so this file's assertions
 *  are what fails rather than the setup's `afterEach`. */
const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

const NO_NAMES: ReadonlySet<string> = new Set();

const ids: WorkId[] = [];
for (let n = 0; n < WORKS; n++) ids.push(serve(workOf(n)));

const answers = useSetupAnswers();
const joins = useJoins();
const notes = useAgentNotes();
const holders = useFileHolders();
const mentions = useWorkMentions();
const split = useWorkSplit();

it("reads a fleet of works one work at a time, and says what the folds said", () => {
  flush();
  const memory = setupMemoryOf(answers(), HOST);
  const whole_ = whole();
  const master = setupMemory([...whole_.values()], HOST);

  expect(raised()).toEqual([]);

  // THE SAME ANSWERS the whole-collection fold gives: the most recent on
  // this host, per key and per harness, and every model a harness ran.
  for (const key of ["mode", "on-green", "planner.harness"] as const)
    expect(memory.last(key, Option.none())).toEqual(
      master.last(key, Option.none()),
    );
  expect(memory.last("planner.model", Option.some("omp"))).toEqual(
    master.last("planner.model", Option.some("omp")),
  );
  expect(Option.isSome(memory.last("planner.model", Option.some("omp")))).toBe(
    true,
  );
  expect(memory.modelsUsed("claude")).toEqual(master.modelsUsed("claude"));
  expect(memory.modelsUsed("claude").length).toBeGreaterThan(1);

  expect(joins()).toEqual(joinsOf(whole_));
  expect(joins().size).toBe(WORKS);
  expect(notes()).toEqual(agentNotes(whole_));
  expect(notes().length).toBe(WORKS);
  expect(holders()).toEqual(fileHolders(whole_));
  expect(holders().size).toBe(WORKS);
  expect(mentions()).toEqual(
    rowsOf().map(([id, record]) => workMentionOf(id, record)),
  );
  expect(
    workMentionCandidates(mentions(), [], NO_NAMES).map((one) => one.name),
  ).toEqual(
    workMentionCandidates(
      rowsOf().map(([id, record]) => workMentionOf(id, record)),
      [],
      NO_NAMES,
    ).map((one) => one.name),
  );
  expect(split.live()).toEqual(inProgress(rowsOf()));
  expect(split.live().length).toBe(WORKS);
  expect(split.done()).toEqual(finished(rowsOf()));
});

it("holds every reading when one work's timeline moves", () => {
  flush();
  const before = {
    answers: answers(),
    joins: joins(),
    notes: notes(),
    holders: holders(),
    mentions: mentions(),
    live: split.live(),
    done: split.done(),
  };

  // Five ticks on one work: nothing they carry is a join, a note, a file or
  // an answer, so no reading moves — and the fourth equal-but-new container
  // is what Solid raises for a fold that cannot hold its own answer.
  const moved = ids[0] as WorkId;
  for (let minute = 400; minute < 405; minute++) tick(moved, minute);

  expect(raised()).toEqual([]);
  // The SAME readings, not equal ones: nothing downstream of them re-ran.
  expect(answers()).toBe(before.answers);
  expect(joins()).toBe(before.joins);
  expect(notes()).toBe(before.notes);
  expect(holders()).toBe(before.holders);
  expect(mentions()).toBe(before.mentions);
  expect(split.live()).toBe(before.live);
  expect(split.done()).toBe(before.done);

  // And a tick that DOES say something moves that work's reading alone: the
  // other twenty-nine rows are the very objects they were.
  setWorks((draft) => {
    const one = draft[moved];
    if (one === undefined) throw new Error("fixture: the work is not served");
    one.events.push({
      at: at(500),
      by: "agent",
      kind: "note",
      about: { kind: "work" },
      text: "and now it is done",
    });
  });
  flush();

  expect(raised()).toEqual([]);
  expect(notes().length).toBe(WORKS + 1);
  expect(notes().slice(0, WORKS)).toEqual(before.notes);
  expect(joins()).toBe(before.joins);
  expect(holders()).toBe(before.holders);
  expect(answers()).toBe(before.answers);
});
