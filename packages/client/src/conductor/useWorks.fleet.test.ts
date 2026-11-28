/** EVERY WHOLE-COLLECTION READING, OVER A FLEET OF 400 WORKS.
 *
 *  `useWorks.wide.test.ts` judges the ORDER at 250 works; this file judges
 *  everything folded from it at a size no join survives by accident. Each of
 *  the eight readings joins one memo per work, so each was `1 + N` sources
 *  and crossed the development build's 200-source judge at about 199 works —
 *  and the palette's rows (`../palette/workActions.ts`) are live whether or
 *  not the palette is open, while the membership index is read by every mark
 *  in the app.
 *
 *  THE MIRROR IS THE REAL ONE (`./collectionMirror.testlib.ts`): the per-key
 *  collection view over real subscription stores, so `keys()` is a store
 *  array and a record read costs what it costs in the browser. A plain mock
 *  under-measures that graph about threefold.
 *
 *  Two assertions per reading, and both are needed: Solid raised NOTHING
 *  (taken off the collector, every grade, `info` included), and the reading
 *  says EXACTLY what the same pure fold says applied to this file's own
 *  plain records, in the order the product publishes. Then one work's
 *  timeline moves and every reading is judged again. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { Option } from "effect";
import {
  answerAsk,
  askQuestions,
  type KoluChoiceKey,
  membershipOf,
  needsYouOf,
  openWork,
  type Question,
  type SentAnswer,
  setupAnswersOf,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkKey,
  type WorkMember,
  workIdOf,
} from "kolu-work";
import { createRoot, flush } from "solid-js";
import { expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  members: undefined as unknown,
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
      workMembers: { use: () => held.members },
      memberReadings: { use: () => held.empty },
      workPrs: { use: () => held.empty },
    },
  },
}));

import { workPaletteRows } from "../palette/workActions";
import { collectionMirror } from "./collectionMirror.testlib";
import { workMentionOf } from "./mentionCandidates";
import { mergeHolders, pathsOf } from "./namedFiles";
import { mergeNotes, notesOfWork } from "./quietChat";
import { joinsOfWork, mergeJoins } from "./turnWorks";
import {
  useAgentNotes,
  useFileHolders,
  useJoins,
  useMembership,
  useNeedsYou,
  useSetupAnswers,
  useWorkMentions,
  useWorks,
  useWorkSplit,
} from "./useWorks";
import { workHost, workSubtitle } from "./workReadings";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET: twice the `1 + N` ceiling, so a join that is merely narrower
 *  than it was is still caught. */
const WORKS = 400;

/** When work `n` started — a shuffle (`n * 97 mod 400` is a bijection: 97 is
 *  coprime with 400), so the published order is a claim about the records. */
const startMinute = (n: number): number => (n * 97) % WORKS;

/** Every fifth work has a setup nobody answered — what needs the human. */
const isAsking = (n: number): boolean => n % 5 === 0;

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

/** ONE WORK, as the mirror carries it: a setup (answered, or still asked),
 *  a terminal that joined it, a note the Conductor wrote and a file it has
 *  seen. Every reading judged below has something to say about it. */
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
          values: new Map<string, SentAnswer>([
            ["q-mode", ["full"]],
            ["q-ph", ["omp"]],
            ["q-pm", [`anthropic/claude-fable-5-${n % 4}`]],
          ]),
        },
      });
  const extra: WorkEvent[] = [
    {
      at: at(startMinute(n) + 3),
      by: "kolu",
      kind: "joined",
      about: { kind: "member", terminal: `${HOST}/t-${n}` },
      role: "planner",
    },
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
const members = collectionMirror<string, WorkMember>("workMembers");
held.works = mirror.view;
held.members = members.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The records as this file holds them, by id — every oracle below folds
 *  THESE, never the product's own readings. */
const plan = new Map<WorkId, Work>();
const ids: WorkId[] = [];
const memberRefs: string[] = [];

const serve = (n: number): void => {
  const work = workOf(n);
  const id = workIdOf(work.key);
  plan.set(id, work);
  ids.push(id);
  mirror.push(id, work);
  const ref = `${HOST}/t-${n}`;
  memberRefs.push(ref);
  members.push(ref, {
    work: id,
    role: "planner",
    joinedAt: at(startMinute(n) + 3),
  });
};

for (let n = 0; n < WORKS; n++) serve(n);
mirror.pushKeys(ids);
members.pushKeys(memberRefs);

/** THE MEMBERSHIP ORDER — oldest start first, which is the order every
 *  per-work reading is folded in. */
const byStart = (): ReadonlyArray<WorkId> =>
  [...plan]
    .toSorted(([, a], [, b]) => (a.startedAt < b.startedAt ? -1 : 1))
    .map(([id]) => id);

/** THE PUBLISHED ORDER — the running works oldest first, then the finished
 *  ones; this fleet has no finished work, so it is the membership order. */
const published = byStart;

const recordOf = (id: WorkId): Work => {
  const one = plan.get(id);
  if (one === undefined) throw new Error(`fixture: ${id} is not served`);
  return one;
};

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const needs = useNeedsYou();
const answers = useSetupAnswers();
const joins = useJoins();
const notes = useAgentNotes();
const holders = useFileHolders();
const mentions = useWorkMentions();
const split = useWorkSplit();
const membership = useMembership();
const paletteRows = createRoot(() => workPaletteRows(useWorks()));

/** Every reading against its own oracle, taken from this file's records. */
const judgeEveryReading = (): void => {
  expect(needs()).toEqual(
    byStart().flatMap((id) => Option.toArray(needsYouOf(id, recordOf(id)))),
  );
  expect(needs().length).toBe(WORKS / 5);
  expect(answers()).toEqual(
    byStart().flatMap((id) => setupAnswersOf(recordOf(id))),
  );
  expect(answers().length).toBeGreaterThan(0);
  expect(joins()).toEqual(
    mergeJoins(byStart().map((id) => joinsOfWork(id, recordOf(id)))),
  );
  expect(joins().size).toBe(WORKS);
  expect(notes()).toEqual(
    mergeNotes(byStart().map((id) => notesOfWork(recordOf(id)))),
  );
  expect(notes().length).toBeGreaterThanOrEqual(WORKS);
  expect(holders()).toEqual(
    mergeHolders(published().map((id) => [id, pathsOf(recordOf(id))] as const)),
  );
  expect(holders().size).toBe(WORKS);
  expect(mentions()).toEqual(
    published().map((id) => workMentionOf(id, recordOf(id))),
  );
  expect(split.live().map(([id]) => id)).toEqual(published());
  expect(split.done()).toEqual([]);
  expect(split.watching().size).toBe(0);
  expect(
    paletteRows().map((one) => [one.name, one.description] as const),
  ).toEqual(
    published().map((id) => {
      const one = recordOf(id);
      return [one.title, workSubtitle(one, workHost(one)).join(" · ")] as const;
    }),
  );
  expect([...membership()]).toEqual([
    ...membershipOf(
      new Map(byStart().map((id) => [id, recordOf(id)] as const)),
      new Map(
        memberRefs.map((ref, n) => [
          ref,
          { work: ids[n] as WorkId, role: "planner" as const },
        ]),
      ),
    ),
  ]);
};

it("joins every whole-collection reading over 400 works, with nothing wide", async () => {
  await settle();
  flush();

  judgeEveryReading();
  expect(raised()).toEqual([]);
});

it("says the same after one work's timeline moves", async () => {
  await settle();
  flush();
  raised();

  // ONE WORK, one more note — the frame a server sends when an agent speaks.
  const moved = ids[3] as WorkId;
  const before = recordOf(moved);
  const after: Work = {
    ...before,
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

  expect(notes().at(-1)?.text).toBe("One more word");
  judgeEveryReading();
  expect(raised()).toEqual([]);
});
