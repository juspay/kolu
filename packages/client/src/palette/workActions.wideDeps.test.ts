/** THE PALETTE'S WORKS SECTION OVER 250 WORKS, ON THE REAL MIRROR — and the
 *  census that says each work is snapshotted ONCE for the app.
 *
 *  `../conductor/useWorks.fleet.test.ts` judges what the section SAYS beside
 *  every other whole-collection reading. This file judges what standing it
 *  costs: the rows are built whether or not the palette is open, so a row
 *  that mints its own `createWorkRecord` puts a SECOND snapshot — a memo per
 *  event and per decision of that work — beside the shared one
 *  (`useWorkRecords`) every other reading already holds. Twice the standing
 *  memos, twice the work on every frame the server sends, for a section
 *  nobody is looking at.
 *
 *  HOW THE CENSUS IS TAKEN, and why this way. Solid's attribution engine is
 *  already installed for every test in this lane
 *  (`@kolu/solid-test-setup/setup` holds it open), and it emits a `create`
 *  record — the node's name, its kind and its first run — on the core's own
 *  channel, `OBSERVE.records`. Subscribing is what turns the record on
 *  (`@solidjs/signals` 2.0.4 `core/dev.d.ts`: the timeline records are built
 *  only while `observed(type)`), so this file counts creations BY NAME off
 *  that channel and nothing else in the lane pays for it. Nothing is mocked
 *  to take the count: the product's own memos (`workRecord`, named in
 *  `../conductor/workRecord.ts`) are what the engine reports, so a census
 *  taken here cannot drift from the graph the browser builds the way a
 *  wrapped `createWorkRecord` or a hand-counted module could.
 *
 *  THE MIRROR IS THE REAL ONE (`../conductor/collectionMirror.testlib.ts`):
 *  the per-key collection view over real subscription stores, so a record
 *  read costs what it costs in the browser and a snapshot that is built twice
 *  subscribes twice.
 *
 *  `useNeedsYou()` is mounted beside the rows because that is the app
 *  (`../commands.tsx` builds both, and the bell reads the first): the shared
 *  snapshots are stood up either way, and the question is whether the rows
 *  join them or mint their own. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import {
  answerAsk,
  askQuestions,
  openWork,
  type Question,
  type SentAnswer,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  workIdOf,
} from "kolu-work";
import { createRoot, flush, OBSERVE } from "solid-js";
import { expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  empty: undefined as unknown,
}));

vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

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

import { collectionMirror } from "../conductor/collectionMirror.testlib";
import { useNeedsYou, useWorks } from "../conductor/useWorks";
import { workHost, workSubtitle } from "../conductor/workReadings";
import { workPaletteRows } from "./workActions";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET. Past the 200-source judge either way, and big enough that a
 *  second snapshot per work is 250 extra standing memo trees. */
const WORKS = 250;

/** When work `n` started — a shuffle (`n * 97 mod 250` is a bijection: 97 is
 *  coprime with 250), so the published order is a claim about the records
 *  rather than the order they were served in. */
const startMinute = (n: number): number => (n * 97) % WORKS;

/** Every fifth work's setup is still asked, so the shared reading mounted
 *  beside the rows has something to say. */
const isAsking = (n: number): boolean => n % 5 === 0;

const SETUP = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
] as const satisfies ReadonlyArray<Question>;

/** ONE WORK as the mirror carries it: a setup (answered, or still asked) and
 *  a short timeline — a note and a file, so a snapshot built twice is two
 *  memos per event and not only two per work. */
const workOf = (n: number): Work => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: `work-${n}`,
    repoBy: { kind: "git" },
  };
  const asked = askQuestions(
    openWork({
      key,
      title: `Work number ${n}`,
      at: at(startMinute(n)),
      request: { kind: "said", text: "do it" },
    }),
    { ask: "setup", questions: SETUP, at: at(startMinute(n) + 1) },
  );
  const settled = isAsking(n)
    ? asked
    : answerAsk(asked, {
        ask: "setup",
        at: at(startMinute(n) + 2),
        from: "card",
        reply: {
          kind: "answered",
          values: new Map<string, SentAnswer>([["q-mode", ["full"]]]),
        },
      });
  const extra: WorkEvent[] = [
    {
      at: at(startMinute(n) + 4),
      by: "agent",
      kind: "note",
      about: { kind: "work" },
      text: `Work ${n} is under way`,
    },
    {
      at: at(startMinute(n) + 5),
      by: "agent",
      kind: "file",
      about: { kind: "work" },
      path: `/home/code/kolu/work-${n}/plan.md`,
    },
  ];
  return { ...settled, events: [...settled.events, ...extra] };
};

const mirror = collectionMirror<WorkId, Work>("works");
held.works = mirror.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The records as this file holds them — the oracle every assertion folds. */
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

/** THE PUBLISHED ORDER — running works oldest first; nothing here has
 *  finished, so it is the membership order. */
const published = (): ReadonlyArray<WorkId> =>
  [...plan]
    .toSorted(([, a], [, b]) => (a.startedAt < b.startedAt ? -1 : 1))
    .map(([id]) => id);

/** What the section should say, row by row. */
const expectedRows = (): ReadonlyArray<readonly [string, string]> =>
  published().map((id) => {
    const one = recordOf(id);
    return [one.title, workSubtitle(one, workHost(one)).join(" · ")] as const;
  });

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

/** THE CENSUS: how many memos of each name the graph has ever stood up.
 *  Subscribed before anything is read, so no creation is missed. */
const born = new Map<string, number>();
if (OBSERVE === undefined)
  throw new Error("this file needs Solid's development build");
OBSERVE.records.subscribe("create", (event) => {
  born.set(event.nodeName, (born.get(event.nodeName) ?? 0) + 1);
});
const madeOf = (name: string): number => born.get(name) ?? 0;

/** Every event the fixture has served, across every work — one `deep` memo
 *  apiece in ONE snapshot of each work. */
const eventsServed = (): number =>
  [...plan.values()].reduce((sum, work) => sum + work.events.length, 0);

const needs = useNeedsYou();
const rows = createRoot(() => workPaletteRows(useWorks()));

it("says every work once, and snapshots every work once", async () => {
  await settle();
  flush();

  expect(rows().map((one) => [one.name, one.description] as const)).toEqual(
    expectedRows(),
  );
  // The words themselves, for two rows this file can name: the repository,
  // the branch, the host and — once its setup is answered — the mode.
  expect(rows().find((one) => one.name === "Work number 1")).toMatchObject({
    description: "kolu · work-1 · local · full",
    section: "works",
  });
  expect(rows().find((one) => one.name === "Work number 5")).toMatchObject({
    description: "kolu · work-5 · local",
    section: "works",
  });
  expect(rows().length).toBe(WORKS);
  // The shared reading mounted beside the rows is live, which is what makes
  // the shared snapshots exist at all.
  expect(needs().length).toBe(WORKS / 5);

  // ONE snapshot per work, not two: the rows read `useWorkRecords`' accessor
  // rather than minting a record of their own.
  expect(madeOf("workRecord")).toBe(WORKS);
  expect(madeOf("workRecord.event")).toBe(eventsServed());

  expect(raised()).toEqual([]);
});

it("says the same after one work's timeline moves", async () => {
  await settle();
  flush();
  raised();
  const beforeEvents = eventsServed();

  // ONE WORK, one more note — the frame a server sends when an agent speaks.
  const moved = ids[3] as WorkId;
  const before = recordOf(moved);
  const after: Work = {
    ...before,
    title: "Work number 3, renamed",
    events: [
      ...before.events,
      {
        at: at(900),
        by: "agent",
        kind: "note",
        about: { kind: "work" },
        text: "One more word",
      },
    ],
  };
  plan.set(moved, after);
  mirror.push(moved, after);
  await settle();
  flush();

  expect(rows().map((one) => [one.name, one.description] as const)).toEqual(
    expectedRows(),
  );
  expect(rows().map((one) => one.name)).toContain("Work number 3, renamed");

  // The one new event is one new memo, in the one snapshot of that work.
  expect(madeOf("workRecord")).toBe(WORKS);
  expect(madeOf("workRecord.event")).toBe(beforeEvents + 1);

  expect(raised()).toEqual([]);
});
