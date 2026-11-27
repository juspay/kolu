/** A READING HOLDS ITS OWN ANSWER WHILE THE RECORDS MOVE UNDER IT.
 *
 *  The whole-works readings — the setup memory a question opens on, the
 *  joins a chat turn is read through, the notes a folded turn says, which
 *  work holds which file, the `@` menu's rows and the board's two halves —
 *  are each folded from one row per work. `useWorks.fleet.test.ts` judges
 *  what they SAY over 400 works; this file judges what they do when a work's
 *  timeline moves and says nothing new.
 *
 *  A fold minting a fresh container per run has an equality gate that never
 *  closes, so every reader re-runs on every timeline tick — Solid's
 *  development build raises `UNSTABLE_MEMO_OUTPUT` on the fourth equal-but-
 *  new value, and a person's chat, `@` menu and board all redraw for an
 *  agent step nobody can see. So the cases below push agent steps that join
 *  nobody, write no file and say nothing, and demand the VERY OBJECTS back:
 *  `toBe`, not `toEqual`. Then one event that does say something moves that
 *  work's reading alone.
 *
 *  THE MIRROR IS THE REAL ONE (`./collectionMirror.testlib.ts`): the per-key
 *  collection view over real `createSubscription` stores, so a step arrives
 *  the way the server delivers one — a frame reconciled into the record's
 *  store, a leaf write and not a record replaced wholesale — and what a
 *  scope subscribes to is what the browser counts.
 *
 *  Every assertion is made beside the diagnostics Solid raised, taken off
 *  the collector so this file's own assertion fails rather than the setup's
 *  `afterEach`, and judged whole: every grade, `info` included. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
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
import { flush } from "solid-js";
import { expect, it, vi } from "vitest";

/** The bound views this file serves, filled in once the mirrors below are
 *  built — the mock factory runs when `./useWorks` first reaches for one. */
const held = vi.hoisted(() => ({
  works: undefined as unknown,
  empty: undefined as unknown,
}));

// The per-key path opens each key's stream through this one call; here it IS
// the procedure, so this file can push frames down a stream of its own.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

// The `works` collection, driven from this file; the three mirrors beside it
// in `useWorks.ts` are empty here — every reading judged below is about works.
vi.mock("../wire", () => ({
  app: {
    collections: {
      works: { use: () => held.works },
      workMembers: { use: () => held.empty },
      memberReadings: { use: () => held.empty },
      workPrs: { use: () => held.empty },
    },
  },
}));

import { collectionMirror } from "./collectionMirror.testlib";
import { workMentionCandidates, workMentionOf } from "./mentionCandidates";
import { mergeHolders, pathsOf } from "./namedFiles";
import { mergeNotes, notesOfWork } from "./quietChat";
import { joinsOfWork, mergeJoins } from "./turnWorks";
import {
  useAgentNotes,
  useFileHolders,
  useJoins,
  useSetupAnswers,
  useWorkMentions,
  useWorkSplit,
} from "./useWorks";

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
const workOf = (n: number): Work => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: `work-${n}`,
    repoBy: { kind: "git" },
  };
  const answered = answerAsk(
    askQuestions(
      openWork({
        key,
        title: `Work number ${n}`,
        at: at(n),
        request: { kind: "said", text: "do it" },
      }),
      { ask: "setup", questions: SETUP, at: at(n + 1) },
    ),
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
  const extra: WorkEvent[] = [
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
  ];
  return { ...answered, events: [...answered.events, ...extra] };
};

/** THE MIRROR, as the client binds one. */
const mirror = collectionMirror<WorkId, Work>("works");
held.works = mirror.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The records as this file holds them — every oracle below folds THESE,
 *  never the product's own readings. */
const plan = new Map<WorkId, Work>();
const ids: WorkId[] = [];

for (let n = 0; n < WORKS; n++) {
  const work = workOf(n);
  const id = workIdOf(work.key);
  plan.set(id, work);
  ids.push(id);
  mirror.push(id, work);
}
mirror.pushKeys(ids);

const recordOf = (id: WorkId): Work => {
  const one = plan.get(id);
  if (one === undefined) throw new Error(`fixture: ${id} is not served`);
  return one;
};

/** THE ORDER EVERY READING IS FOLDED IN: oldest start first, and every work
 *  here is still in progress, so it is the published order too. */
const byStart = (): ReadonlyArray<WorkId> =>
  [...plan]
    .toSorted(([, a], [, b]) => (a.startedAt < b.startedAt ? -1 : 1))
    .map(([id]) => id);

/** Serve one work's next frame, as the server delivers one: the same record
 *  with one more event on it, reconciled into the record's own store. */
const publish = async (id: WorkId, event: WorkEvent): Promise<void> => {
  const before = recordOf(id);
  const after: Work = { ...before, events: [...before.events, event] };
  plan.set(id, after);
  mirror.push(id, after);
  await settle();
  flush();
};

/** Every diagnostic Solid raised, in one line each — every grade, `info`
 *  included. */
const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const NO_NAMES: ReadonlySet<string> = new Set();

const answers = useSetupAnswers();
const joins = useJoins();
const notes = useAgentNotes();
const holders = useFileHolders();
const mentions = useWorkMentions();
const split = useWorkSplit();

it("reads a fleet of works one work at a time, and says what the folds said", async () => {
  await settle();
  flush();

  // THE SAME ANSWERS the whole-collection fold gives: the most recent on
  // this host, per key and per harness, and every model a harness ran.
  const memory = setupMemoryOf(answers(), HOST);
  const master = setupMemoryOf(
    byStart().flatMap((id) => setupAnswersOf(recordOf(id))),
    HOST,
  );
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

  expect(joins()).toEqual(
    mergeJoins(byStart().map((id) => joinsOfWork(id, recordOf(id)))),
  );
  expect(joins().size).toBe(WORKS);
  expect(notes()).toEqual(
    mergeNotes(byStart().map((id) => notesOfWork(recordOf(id)))),
  );
  expect(notes().length).toBe(WORKS);
  expect(holders()).toEqual(
    mergeHolders(byStart().map((id) => [id, pathsOf(recordOf(id))] as const)),
  );
  expect(holders().size).toBe(WORKS);

  const rows = byStart().map((id) => workMentionOf(id, recordOf(id)));
  expect(mentions()).toEqual(rows);
  // The `@` menu's own offer, which is what a person types against.
  expect(
    workMentionCandidates(mentions(), [], NO_NAMES).map((one) => one.name),
  ).toEqual(workMentionCandidates(rows, [], NO_NAMES).map((one) => one.name));
  expect(split.live().map(([id]) => id)).toEqual(byStart());
  expect(split.live().length).toBe(WORKS);
  expect(split.done()).toEqual([]);

  expect(raised()).toEqual([]);
});

it("holds every reading when one work's timeline moves", async () => {
  await settle();
  flush();
  raised();
  const before = {
    answers: answers(),
    joins: joins(),
    notes: notes(),
    holders: holders(),
    mentions: mentions(),
    live: split.live(),
    done: split.done(),
  };

  // Five steps on one work: nothing they carry is a join, a note, a file or
  // an answer, so no reading moves — and the fourth equal-but-new container
  // is what Solid raises for a fold that cannot hold its own answer.
  const moved = ids[0] as WorkId;
  for (let minute = 400; minute < 405; minute++)
    await publish(moved, stepOf(minute));

  expect(raised()).toEqual([]);
  // The SAME readings, not equal ones: nothing downstream of them re-ran.
  expect(answers()).toBe(before.answers);
  expect(joins()).toBe(before.joins);
  expect(notes()).toBe(before.notes);
  expect(holders()).toBe(before.holders);
  expect(mentions()).toBe(before.mentions);
  expect(split.live()).toBe(before.live);
  expect(split.done()).toBe(before.done);

  // And an event that DOES say something moves that work's reading alone:
  // the other twenty-nine rows are the very objects they were.
  await publish(moved, {
    at: at(500),
    by: "agent",
    kind: "note",
    about: { kind: "work" },
    text: "and now it is done",
  });

  expect(raised()).toEqual([]);
  expect(notes().length).toBe(WORKS + 1);
  expect(notes().at(-1)?.text).toBe("and now it is done");
  expect(notes().slice(0, WORKS)).toEqual(before.notes);
  expect(joins()).toBe(before.joins);
  expect(holders()).toBe(before.holders);
  expect(answers()).toBe(before.answers);
});
