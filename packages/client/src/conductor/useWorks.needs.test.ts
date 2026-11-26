/** WHAT NEEDS THE HUMAN, PUBLISH AFTER PUBLISH — the works mirror hands out a
 *  fresh container every time anything in it moves, and the list read off it
 *  is what the bell, the tab's number, the OS badge and the palette count.
 *  Two properties, each of which Solid's development build judges:
 *
 *   - a run of publishes that leave the list EMPTY must not republish it. A
 *     fold minting a fresh `[]` each run has an equality gate that never
 *     closes, so every reader of the count re-runs on every timeline tick —
 *     `UNSTABLE_MEMO_OUTPUT`, raised on the fourth equal-but-new value;
 *   - a fleet of works must not put every record's leaves on ONE scope. Read
 *     work by work, the list's scope is the row memos and a record's leaves
 *     are its own row's — `WIDE_SCOPE_DEPS`, raised at 200 sources.
 *
 *  Both are asserted on the diagnostics Solid raised AND on the list itself:
 *  a narrower graph that counts a different thing is no fix.
 *
 *  The two tests share one mirror (the works roots are app-lifetime), so each
 *  seeds works of its own and judges the whole list it then reads. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import {
  askQuestions,
  openWork,
  type Question,
  type Work,
  type WorkEvent,
  type WorkId,
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
// in `useWorks.ts` are empty here — the needs-you reading is about works.
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

import { useNeedsYou } from "./useWorks";

const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** The work as this file grows it: one timeline it appends to in place, so a
 *  publish is a LEAF write the way a server frame is, and not a record
 *  replaced wholesale. */
type GrowingWork = Omit<Work, "events"> & { events: WorkEvent[] };

const [works, setWorks] = createStore<Record<string, GrowingWork>>({});
mirror.keys = () => Object.keys(works) as WorkId[];
mirror.read = (id) => works[id];

/** An agent step: it moves the timeline and hands the work to nobody, so the
 *  needs-you reading of a work it is appended to does not change. */
const stepOf = (minute: number): WorkEvent => ({
  at: at(minute),
  by: "agent",
  kind: minute % 2 === 0 ? "asking" : "ready",
  about: { kind: "member", terminal: "t" },
  why: { kind: "none" },
});

/** A work the agent is working on, with a timeline of its own. */
const working = (n: number): GrowingWork => {
  const opened = openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/home/code/kolu",
      branch: `work-${n}`,
      repoBy: { kind: "git" },
    },
    title: `Work ${n}`,
    at: at(n),
    request: { kind: "said", text: "do it" },
  });
  return {
    ...opened,
    events: [
      ...opened.events,
      ...Array.from({ length: 8 }, (_, step) => stepOf(n + step + 1)),
    ],
  };
};

const QUESTIONS = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
] as const satisfies ReadonlyArray<Question>;

/** The same work, with an ask nobody has answered: it waits on the human. */
const asking = (n: number): GrowingWork => {
  const work = askQuestions(working(n), {
    ask: "setup",
    questions: QUESTIONS,
    at: at(n + 20),
  });
  return { ...work, events: [...work.events] };
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

/** The codes Solid raised, taken off the collector so this file's assertions
 *  are what fails rather than the setup's `afterEach`. */
const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

it("holds the empty needs list across a run of publishes", () => {
  const first = serve(working(0));
  serve(working(1));
  const needs = useNeedsYou();
  flush();
  const empty = needs();
  expect(empty).toEqual([]);

  // Five ticks on a work that waits on nobody: the list stays empty, and the
  // fourth equal-but-new reading of it is what Solid raises.
  for (let minute = 40; minute < 45; minute++) tick(first, minute);

  expect(raised()).toEqual([]);
  // The SAME list, not an equal one: nothing downstream of it re-ran.
  expect(needs()).toBe(empty);
});

it("reads a fleet of works one work at a time", () => {
  const waiting: WorkId[] = [];
  for (let n = 2; n < 32; n++) {
    const work = n % 3 === 0 ? asking(n) : working(n);
    const id = serve(work);
    if (n % 3 === 0) waiting.push(id);
  }
  const needs = useNeedsYou();
  flush();
  const found = needs();

  expect(raised()).toEqual([]);
  expect(found.map((one) => one.work)).toEqual(waiting);
  expect(found.map((one) => one.wanted)).toEqual(
    waiting.map(() => "Which mode?"),
  );

  // One work's timeline moving leaves every other item's object alone.
  tick(waiting[0] as WorkId, 200);
  expect(raised()).toEqual([]);
  expect(needs().slice(1)).toEqual(found.slice(1));
  expect(needs()[1]).toBe(found[1]);
});
