/** A FLEET WIDER THAN THE THRESHOLD — 250 works in the mirror at once, which
 *  is what a long-lived server holds after a few days of waterfalls.
 *
 *  `useWorks` is the one reading EVERY other reading is folded from: the per-
 *  work split (`perWork`, `useWorkRecords`) takes its id list, so whatever
 *  the split saves downstream, the ordering's own scope used to be the whole
 *  collection. Sorting the records by `startedAt` before `inProgress` and
 *  `finished` divide them reads, off the store and on ONE memo, THREE leaves
 *  per open work (`startedAt`, `state`, `state.kind`) and FOUR per ended one
 *  (those three and `state.at`), plus the works map itself: `1 + 3·open +
 *  4·ended` sources, which this fleet puts at 835. The map that fed it is
 *  `1 + N` on its own (one per-key accessor per key), which is 251 here.
 *  Solid's development build judges both at 200 (`@solidjs/signals` 2.0.4
 *  `dist/dev.attribution.js`, `wideDeps: 200`, `checkDepWidth`) and raises
 *  `WIDE_SCOPE_DEPS` — and ONE work started, ended or re-keyed re-runs the
 *  ordering for all 250, and every reading beneath it.
 *
 *  Four things are asserted together, because any one alone would let a
 *  false fix through:
 *
 *   - Solid raised NOTHING. `takeSolidDiagnostics()` is taken off the
 *     collector so this file's own assertion fails rather than the setup's
 *     `afterEach`, and it is judged whole — `info` included. Nothing a
 *     works ordering does is advisory (the one advisory code,
 *     `EFFECT_RELAY_TEAR`, is a DOM measurement's);
 *   - the ORDER is exactly the docstring's: in progress oldest first, then
 *     the finished ones most recently ended first. A narrower graph that
 *     reorders the board is no fix, so the expected list is computed from
 *     the fixture's own plan — the minutes this file chose — and never from
 *     the product's folds;
 *   - every reading folded FROM that order publishes it too: the board's two
 *     halves (`useWorkSplit`), the `@` menu's rows (`useWorkMentions`) and
 *     the works offered when two of them hold one file
 *     (`useFileHolders`, the `choose` list) — so a fix that moves the width
 *     onto another scope, or quietly re-orders what a person sees, is
 *     caught;
 *   - ONE work's leaf moving re-runs ONE work's row and no other's, counted
 *     in a `perWork` reading's own `of`.
 *
 *  The start minutes are SHUFFLED (`n * 97 mod 250`, a bijection because 97
 *  and 250 are coprime) and the end minutes shuffled differently
 *  (`n * 131 mod 250`), so neither order is the key order, the insertion
 *  order, or each other: an ordering that merely kept arrival order would
 *  read correct only by accident. Every minute is distinct, so both
 *  comparisons are total and the expected list is the only right answer.
 *
 *  Then ONE more work is published into the live mirror and the order is
 *  judged again, at a start minute that lands it in the MIDDLE of the works
 *  in progress (half past the tenth): a list that only appends would pass
 *  the first assertion and fail this one. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import {
  endWork,
  openWork,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  workIdOf,
} from "kolu-work";
import { createRoot, flush } from "solid-js";
import { expect, it, vi } from "vitest";

/** The bound views this file serves, filled in once the mirrors below are
 *  built — the mock factory runs when `./useWorks` first reaches for one. */
const held = vi.hoisted(() => ({
  works: undefined as unknown,
  empty: undefined as unknown,
}));

// The per-key path opens each key's stream through this one call
// (`useCollection.ts:142-153`); here it IS the procedure, so this file can
// push frames down a stream of its own.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

// The `works` collection, driven from this file; the three mirrors beside it
// in `useWorks.ts` are empty here — the reading judged below is about works.
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
import { workMentionOf } from "./mentionCandidates";
import {
  perWork,
  useFileHolders,
  useWorkMentions,
  useWorks,
  useWorkSplit,
} from "./useWorks";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET: 250 works — past `wideDeps`' 200 with room to spare on every
 *  reading below, and the size a server that has been up for days holds. */
const WORKS = 250;

/** When work `n` started — a shuffle of 0…249 rather than the key order, so
 *  "oldest first" is a claim about the records and not about arrival. */
const startMinute = (n: number): number => (n * 97) % WORKS;

/** Every third work has finished: both halves of the order are crowded, and
 *  neither is the whole list. */
const isEnded = (n: number): boolean => n % 3 === 0;

/** When work `n` ended — a DIFFERENT shuffle, well after every start, so the
 *  finished half's order cannot be read off the starts. */
const endMinute = (n: number): number => 1000 + ((n * 131) % WORKS);

/** THE PATH EVERY WORK HOLDS — what makes the file-holder index's `choose`
 *  offer the whole fleet, in the works' own order. A work in progress holds
 *  the files it has SEEN; one that ended holds the copies kolu KEPT, so both
 *  halves are written their own way. */
const SHARED = ".waterfall/plan.md";

/** One work as the fixture planned it: the record the expected readings are
 *  built from, beside the id the mirror files it under. */
type Planned = {
  readonly id: WorkId;
  readonly start: number;
  readonly end: number | undefined;
  readonly record: Work;
};

/** ONE WORK, as small as the mirror carries one: opened, one file seen, and
 *  stopped — holding a kept copy of the same path — when the plan says so.
 *  Nothing else is on its timeline: a long timeline is another file's
 *  subject (`useWorks.longWork.test.ts`), and here it would only confuse the
 *  fleet's own width with a record's depth. */
const workOf = (plan: { readonly n: number; readonly start: number }): Work => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: `work-${plan.n}`,
    repoBy: { kind: "git" },
  };
  const opened = openWork({
    key,
    title: `Work number ${plan.n}`,
    at: at(plan.start),
    request: { kind: "said", text: "do it" },
  });
  const seen: WorkEvent = {
    at: at(plan.start),
    by: "agent",
    kind: "file",
    about: { kind: "work" },
    path: SHARED,
  };
  const working: Work = { ...opened, events: [...opened.events, seen] };
  if (!isEnded(plan.n)) return working;
  const over = endWork(working, {
    outcome: { kind: "stopped", by: "you" },
    at: at(endMinute(plan.n)),
  });
  // The ending keeps nothing by itself; this fleet's ended works each keep
  // their one file, so the holder index covers both halves of the order.
  return over.state.kind === "ended"
    ? { ...over, state: { ...over.state, kept: [{ path: SHARED, bytes: 12 }] } }
    : over;
};

/** THE MIRRORS, as the client binds them: the real per-key collection view
 *  over real subscription stores ({@link collectionMirror}), so a fold's
 *  width here is the width the browser would count. */
const mirror = collectionMirror<WorkId, Work>("works");
held.works = mirror.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The ids served, in the order the keys frame names them. */
const servedIds: WorkId[] = [];

/** Put a work in the mirror, as its own key, and remember what it was for
 *  the expected order. */
const serve = (plan: {
  readonly n: number;
  readonly start: number;
}): Planned => {
  const work = workOf(plan);
  const id = workIdOf(work.key);
  mirror.push(id, work);
  servedIds.push(id);
  mirror.pushKeys(servedIds);
  return {
    id,
    start: plan.start,
    end: isEnded(plan.n) ? endMinute(plan.n) : undefined,
    record: work,
  };
};

/** THE ORDER THE DOCSTRING PROMISES, from the fixture's own minutes: in
 *  progress oldest first, then the finished ones most recently ended first.
 *  No product fold is involved — this is the oracle, not a second reading. */
const live = (plan: ReadonlyArray<Planned>): ReadonlyArray<Planned> =>
  plan
    .filter((one) => one.end === undefined)
    .toSorted((a, b) => a.start - b.start);

const done = (plan: ReadonlyArray<Planned>): ReadonlyArray<Planned> =>
  plan
    .filter((one) => one.end !== undefined)
    .toSorted((a, b) => (b.end ?? 0) - (a.end ?? 0));

const order = (plan: ReadonlyArray<Planned>): ReadonlyArray<Planned> => [
  ...live(plan),
  ...done(plan),
];

/** The codes Solid raised, taken off the collector so this file's assertions
 *  are what fails rather than the setup's `afterEach`. Every grade is kept,
 *  `info` included. */
const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const planned: Planned[] = [];
for (let n = 0; n < WORKS; n++)
  planned.push(serve({ n, start: startMinute(n) }));

/** The work whose title is written below — one leaf of one work, which must
 *  re-run that work's row and no other. */
const MOVED = planned[7] as Planned;

const rows = useWorks();
const split = useWorkSplit();
const mentions = useWorkMentions();
const holders = useFileHolders();

/** HOW MANY TIMES EACH WORK'S OWN ROW RAN — counted in a `perWork` reading's
 *  `of`, which is the per-work seam every whole-collection reading is built
 *  on. A reading whose rows all re-run for one work's leaf is the wide fold
 *  this file exists to forbid, worn as a narrower graph. */
const runs = new Map<WorkId, number>();
const counted = createRoot(() =>
  perWork("wideFleetRuns", (id, record) => {
    runs.set(id, (runs.get(id) ?? 0) + 1);
    return record.title;
  }),
);

it("orders a fleet of 250 works without subscribing one memo to all of them", async () => {
  await settle();
  flush();

  // THE ORDER FIRST, so a run that fails on the diagnostic below has already
  // said that the ordering itself is the one every reader draws.
  expect(rows().length).toBe(WORKS);
  expect(rows().map(([id]) => id)).toEqual(order(planned).map((one) => one.id));
  // The halves are what they claim: the open ones first, every one of them.
  expect(
    rows()
      .slice(0, live(planned).length)
      .every(([, one]) => one.state.kind === "open"),
  ).toBe(true);
  expect(
    rows()
      .slice(live(planned).length)
      .every(([, one]) => one.state.kind === "ended"),
  ).toBe(true);

  // THE BOARD'S TWO HALVES, each in its own order.
  expect(split.live().map(([id]) => id)).toEqual(
    live(planned).map((one) => one.id),
  );
  expect(split.done().map(([id]) => id)).toEqual(
    done(planned).map((one) => one.id),
  );

  // THE `@` MENU, in the works' own order, row for row.
  expect(mentions()).toEqual(
    order(planned).map((one) => workMentionOf(one.id, one.record)),
  );

  // THE FILE-HOLDER `choose` OFFER: every work holds the one path, and the
  // offer is made in the order the board draws them.
  expect(holders().get(SHARED)).toEqual(order(planned).map((one) => one.id));
  expect(holders().size).toBe(1);

  // AND NOTHING SOLID RAISED while it read them — every grade, `info`
  // included.
  expect(raised()).toEqual([]);
});

it("re-runs one work's row for one work's leaf", async () => {
  await settle();
  flush();
  expect(counted().length).toBe(WORKS);
  raised();
  runs.clear();

  // ONE LEAF OF ONE RECORD, as the server delivers one: the same work, with
  // the same timeline, under a new title. The subscription writes the frame
  // into its store field by field, so this is a leaf write and not a record
  // replaced wholesale.
  mirror.push(MOVED.id, { ...MOVED.record, title: "Work number 7, renamed" });
  await settle();
  flush();

  // ONE ROW RAN: the work whose title moved, once.
  expect([...runs]).toEqual([[MOVED.id, 1]]);
  // And the reading itself says the new word, in its place.
  const moved = order(planned).findIndex((one) => one.id === MOVED.id);
  expect(mentions()[moved]?.title).toBe("Work number 7, renamed");
  expect(mentions().length).toBe(WORKS);
  expect(rows().map(([id]) => id)).toEqual(order(planned).map((one) => one.id));
  expect(raised()).toEqual([]);
});
it("keeps the exact order when one more work is published into the fleet", async () => {
  await settle();
  flush();
  raised();

  // Half past the tenth minute: between the works that started at minute 10
  // and at minute 11, so an ordering that appended would be caught here.
  const late = serve({ n: WORKS, start: 10.5 });
  await settle();
  flush();

  expect(raised()).toEqual([]);
  expect(rows().length).toBe(WORKS + 1);
  const expected = order([...planned, late]);
  expect(rows().map(([id]) => id)).toEqual(expected.map((one) => one.id));
  expect(split.live().map(([id]) => id)).toEqual(
    live([...planned, late]).map((one) => one.id),
  );
  expect(split.done().map(([id]) => id)).toEqual(
    done([...planned, late]).map((one) => one.id),
  );
  expect(mentions().map((one) => one.work)).toEqual(
    expected.map((one) => one.id),
  );
  expect(holders().get(SHARED)).toEqual(expected.map((one) => one.id));
});
