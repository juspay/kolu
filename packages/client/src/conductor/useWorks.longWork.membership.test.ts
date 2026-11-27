/** ONE WORK WITH A LONG TIMELINE, AND A TERMINAL IN IT — the two readings
 *  that walk a work EVENT BY EVENT rather than work by work.
 *
 *  `useWorks.longWork.test.ts` pins the per-work folds at 102 events; this
 *  file is the same axis at the length a work reaches after a month (only
 *  agent-state events are capped — `AGENT_STATES_KEPT = 30`,
 *  `packages/work/src/record.ts` — so files, notes, asks and steps grow
 *  without a bound), and it adds the one reading that was still folding the
 *  LIVE records:
 *
 *   - `workRecord` (`./workRecord.ts`) joins one memo per event and one per
 *     decision, so its own scope was `1 per event + 1 per decision + 6` —
 *     338 sources on this fixture, which Solid's development build judges at
 *     200 (`wideDeps`, `@solidjs/signals` 2.0.4 `dist/dev.attribution.js`);
 *   - `membership` (`useWorks.ts`) folded the works' store PROXIES, so
 *     `driverOf`'s backward walk to the member's `joined` event
 *     (`packages/work/src/waterfall.ts`) read about four leaves per event it
 *     crossed — past 200 at about fifty events in ONE work with a member.
 *
 *  Both are judged here by the same two assertions: Solid raised NOTHING
 *  (taken off the collector, every grade, `info` included), and the readings
 *  say EXACTLY what the same folds say applied to the fixture's own plain
 *  record. Then the timeline moves by one event and both are judged again,
 *  because a graph that is narrow only until it is touched is no fix. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import {
  answerAsk,
  askQuestions,
  type KoluChoiceKey,
  membershipOf,
  openWork,
  type Question,
  type SentAnswer,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  type WorkMember,
  workIdOf,
} from "kolu-work";
import { settle } from "@kolu/surface/solid/testlib";
import { flush } from "solid-js";
import { expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  members: undefined as unknown,
  empty: undefined as unknown,
}));

// The per-key path opens each key's stream through this one call; here it IS
// the procedure, so this file can push frames down a stream of its own.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

// The `works` collection and the `workMembers` map beside it, both driven
// from this file through the REAL per-key collection view, so what is
// counted here is what the browser counts.
vi.mock("../wire", () => ({
  app: {
    collections: {
      works: { use: () => held.works },
      workMembers: { use: () => held.members },
      memberReadings: { use: () => held.empty },
      workPrs: { use: () => held.empty },
    },
  },
}));

import { collectionMirror } from "./collectionMirror.testlib";

import { mergeNotes, notesOfWork } from "./quietChat";
import { joinsOfWork, mergeJoins } from "./turnWorks";
import { useAgentNotes, useJoins, useMembership } from "./useWorks";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** The timeline's length: past `wideDeps`' 200 on the snapshot's own join,
 *  and five times the walk `driverOf` makes back to the member's join. */
const EVENTS = 250;

/** The terminal in the work — what makes the membership index non-empty, and
 *  what `driverOf` walks the timeline backwards for. */
const TERMINAL = `${HOST}/t-9`;

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
] as const satisfies ReadonlyArray<Question>;

/** The work as this file grows it: one timeline it appends to in place, so a
 *  publish is a LEAF write the way a server frame is. */
type GrowingWork = Omit<Work, "events"> & { events: WorkEvent[] };

/** An agent step: it moves the timeline, joins nobody and says nothing. */
const stepOf = (minute: number): WorkEvent => ({
  at: at(minute),
  by: "agent",
  kind: minute % 2 === 0 ? "asking" : "ready",
  about: { kind: "member", terminal: TERMINAL },
  why: { kind: "none" },
});

/** ONE LONG WORK: a settled setup, the terminal that joined it early on, a
 *  note, and steps enough to reach {@link EVENTS} after it. */
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
  const events: WorkEvent[] = [
    ...answered.events,
    {
      at: at(3),
      by: "kolu",
      kind: "joined",
      about: { kind: "member", terminal: TERMINAL },
      role: "planner",
    },
    {
      at: at(4),
      by: "agent",
      kind: "note",
      about: { kind: "work" },
      text: "Under way",
    },
  ];
  // Everything after the join is what `driverOf` walks back across.
  for (let minute = 5; events.length < EVENTS; minute++)
    events.push(stepOf(minute));
  return { ...answered, events };
};

const mirror = collectionMirror<WorkId, Work>("works");
const memberMirror = collectionMirror<string, WorkMember>("workMembers");
held.works = mirror.view;
held.members = memberMirror.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The record as this file holds it, and the one the mirror serves — every
 *  oracle below folds THIS, never the product's own reading. */
let plan = longWork() as Work;
const id = workIdOf(plan.key);
mirror.push(id, plan);
mirror.pushKeys([id]);
memberMirror.push(TERMINAL, {
  work: id,
  role: "planner",
  joinedAt: at(3),
});
memberMirror.pushKeys([TERMINAL]);

const record = (): Work => plan;

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const membership = useMembership();
const joins = useJoins();
const notes = useAgentNotes();

it("reads a 250-event work and its member without one wide memo", async () => {
  await settle();
  flush();
  const held = record();

  expect(held.events.length).toBe(EVENTS);
  expect(joins()).toEqual(mergeJoins([joinsOfWork(id, held)]));
  expect(notes()).toEqual(mergeNotes([notesOfWork(held)]));
  expect([...membership()]).toEqual([
    ...membershipOf(
      new Map([[id, held]]),
      new Map([[TERMINAL, { work: id, role: "planner" as const }]]),
    ),
  ]);
  expect(membership().get(TERMINAL)?.title).toBe("A work with a long timeline");

  expect(raised()).toEqual([]);
});

it("holds both readings narrow when the long timeline moves", async () => {
  await settle();
  flush();
  raised();

  // ONE MORE EVENT on the same work, as a server frame delivers it: the
  // subscription writes the frame into its store, so the appended event is a
  // leaf write under the record already there.
  plan = {
    ...plan,
    events: [
      ...plan.events,
      {
        at: at(EVENTS + 10),
        by: "agent",
        kind: "note",
        about: { kind: "work" },
        text: "One more word",
      },
    ],
  };
  mirror.push(id, plan);
  await settle();
  flush();

  const held = record();
  expect(held.events.length).toBe(EVENTS + 1);
  expect(notes()).toEqual(mergeNotes([notesOfWork(held)]));
  expect(notes().at(-1)?.text).toBe("One more word");
  expect(joins()).toEqual(mergeJoins([joinsOfWork(id, held)]));
  expect([...membership()]).toEqual([
    ...membershipOf(
      new Map([[id, held]]),
      new Map([[TERMINAL, { work: id, role: "planner" as const }]]),
    ),
  ]);

  expect(raised()).toEqual([]);
});
