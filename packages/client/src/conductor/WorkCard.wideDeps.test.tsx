// @vitest-environment happy-dom
/**
 * A LONG RECORD IS SUBSCRIBED ONCE, NOT LEAF BY LEAF.
 *
 * Every fact a card draws about its work — where it stands, how long it has
 * waited on you, its stages, its timeline, who it waits on — is a fold over
 * the WHOLE record. Read off the store directly, each of those folds
 * subscribes every leaf it touches, so a work with a long timeline gives one
 * card six scopes of two hundred and more sources each, and Solid's
 * attribution engine raises `WIDE_SCOPE_DEPS` on every one of them (the
 * finding that fails this suite's `afterEach`, and the `solid-dev` e2e lane
 * with it).
 *
 * The fix these cases hold is the one read: `deep()` subscribes a record's
 * container and deep witness — two nodes per record rather than one per leaf
 * — and hands on a plain snapshot, so each fold built on it carries a single
 * dependency.
 *
 * THE MIRROR IS THE REAL ONE (`./collectionMirror.testlib.ts`): the per-key
 * collection view over real `createSubscription` stores, so the record a card
 * is handed is the store proxy the browser hands it, `keys()` is a store
 * array, and what a scope subscribes to here is what the browser counts. A
 * hand-written `{ keys, byKey }` serving plain records under-measures that
 * graph about threefold, and a fold that looks narrow under it can still be
 * judged in the browser.
 *
 * The fixture is a work whose timeline is the length the lane's own works
 * reach. The children that are not this card's own reading are stubbed:
 * what each of them subscribes is its own subject, not this one's.
 *
 * Each case judges three things together: every diagnostic Solid raised,
 * `info` graded ones included; what the face DREW, in the exact words or
 * attributes a person sees; and both again after one more event lands on the
 * record.
 */

import {
  ABOUT_WORK,
  endWork,
  joinWork,
  openWork,
  type RecordableEvent,
  recordEvent,
  type Work,
  type WorkId,
  type WorkMember,
  workIdOf,
} from "kolu-work";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { flush, Show } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";

/** The bound views this file serves, filled in once the mirrors below are
 *  built — the mock factory runs when `./useWorks` first reaches for one. */
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

// The collections this card reads, as the client binds them. The readings
// themselves (`./useWorks`) are the real ones, over the real mirror. The rest
// of the wire is inert: nothing this card draws dials a host.
vi.mock("../wire", async () => {
  // `vi.mock`'s factory is hoisted above this file's imports, so the one
  // value it needs from another module is reached for here.
  const { Effect } = await import("effect");
  return {
    app: {
      collections: {
        works: { use: () => held.works },
        workMembers: { use: () => held.members },
        memberReadings: { use: () => held.empty },
        workPrs: { use: () => held.empty },
      },
      cells: new Proxy(
        {},
        { get: () => ({ use: () => ({ value: () => undefined }) }) },
      ),
    },
    client: { server: { info: () => Effect.never } },
    activeHost: () => ({ kind: "local" }),
    encActiveHost: () => "local",
    hostKeys: () => [],
    padiMap: { useEntry: () => undefined },
    padiRpcOf: () => ({}),
    activePadiRpc: () => ({}),
    interpretClientError: () => {},
  };
});
// The fleet, as far as this card is concerned: nothing of its terminal is in
// it — no standing, no rows. The module's pure helpers stay real.
vi.mock(import("../palette/fleetTerminals"), async (importOriginal) => ({
  ...(await importOriginal()),
  fleetTerminalStanding: () => ({ kind: "gone" }) as const,
  useFleetTerminalIndex: () => () => [],
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answerWork: vi.fn(), answer: vi.fn(), send: vi.fn() }),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
// `WorkCardActions` is NOT mocked: its own fold over the record
// (`needsYouOf`) is one of the scopes this file judges, and it is drawn on
// the board face below.
// `WorkTerminals` is mocked (its rows are a terminal's reading, not this
// work's); `WorkSubtitle` is NOT — the line under the title folds the whole
// record for its setup and its PR, and the card hands it the snapshot.
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));

/** HOW OFTEN A FOLD RAN — counted around the real reading, so what it
 *  subscribes to is unchanged and only the count is this file's. */
const folds = vi.hoisted(() => ({ timeSpentOnYou: 0 }));
type Readings = Record<string, unknown> & {
  timeSpentOnYou: (work: Work, now: string) => number;
};
vi.mock("./workReadings", async (importOriginal) => {
  const real = (await importOriginal()) as Readings;
  return {
    ...real,
    timeSpentOnYou: (work: Work, now: string): number => {
      folds.timeSpentOnYou += 1;
      return real.timeSpentOnYou(work, now);
    },
  };
});

import { settle } from "@kolu/surface/solid/testlib";
import { Shown } from "../ui/shown";
import { collectionMirror } from "./collectionMirror.testlib";
import WorkCard from "./WorkCard";
import WorkChipFace from "./WorkChipFace";
import { pickWork, unpickWork } from "./workListing";

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const HOST = "local";
const TERMINAL = "t";
const REF = `${HOST}/${TERMINAL}`;
const TITLE = "A work with a long timeline";
const KEY = {
  kind: "branch",
  host: HOST,
  repo: "/r",
  branch: "long-record",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const MEMBER = { kind: "member", terminal: TERMINAL } as const;

/** ONE ROUND OF A TIMELINE, in the events kolu really records: the agent
 *  asking and coming back, a file landing in the worktree, and the forge's
 *  answer about the branch. */
const round = (i: number): ReadonlyArray<RecordableEvent> => [
  {
    at: at(i * 60_000 + 2_000),
    by: "kolu",
    about: { ...MEMBER },
    kind: "asking",
    why: { kind: "none" },
  },
  {
    at: at(i * 60_000 + 3_000),
    by: "kolu",
    about: { ...MEMBER },
    kind: "ready",
    why: { kind: "none" },
  },
  {
    at: at(i * 60_000 + 4_000),
    by: "agent",
    about: { ...MEMBER },
    kind: "file",
    path: `.waterfall/step-${i}.md`,
  },
  {
    at: at(i * 60_000 + 5_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-running",
    pr: 7,
    head: { kind: "commit", sha: `sha${i}` },
    failing: [],
  },
  {
    at: at(i * 60_000 + 6_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-passed",
    pr: 7,
    head: { kind: "commit", sha: `sha${i}` },
    failing: [],
  },
];

/** HOW LONG THE TIMELINE IS. Twenty rounds is 102 events: every fold that
 *  reads the record leaf by leaf is then subscribed to five hundred and more
 *  sources — the engine's threshold is two hundred — while the one reading
 *  of the record is subscribed to a source per event. */
const ROUNDS = 20;

const grown = (): Work => {
  let work = openWork({
    key: KEY,
    title: TITLE,
    at: at(0),
    request: { kind: "none" },
  });
  work = joinWork(work, {
    terminal: TERMINAL,
    role: "planner",
    at: at(1_000),
  });
  for (let i = 0; i < ROUNDS; i++)
    for (const one of round(i)) work = recordEvent(work, one);
  return work;
};

const ended = (): Work =>
  endWork(grown(), {
    outcome: { kind: "stopped", by: "you" },
    at: at(ROUNDS * 60_000 + 10_000),
  });

/** WHERE THE TIME WENT on the ended work, in the words the details draw —
 *  built from the fixture's own timeline rather than from the reading under
 *  test. Twenty rounds of a minute each, and the agent held the work through
 *  every one of them: it never waited on a person and the forge's checks
 *  passed within the round, so the whole twenty minutes is the agents'. */
const TIME_SPENT = "Agents 20m";

/** The work with one more thing on it: the agent came back with a question,
 *  so the work now waits on YOU. */
const asking = (): Work =>
  recordEvent(grown(), {
    at: at(ROUNDS * 60_000 + 7_000),
    by: "agent",
    about: { ...MEMBER },
    kind: "question",
    ask: "the last word",
  });

/** THE MIRRORS, as the client binds them: the real per-key collection view
 *  over real subscription stores. */
const works = collectionMirror<WorkId, Work>("works");
const members = collectionMirror<string, WorkMember>("workMembers");
held.works = works.view;
held.members = members.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The work as the mirror serves it — the store proxy a board row is handed,
 *  not a record this file built. `undefined` until its first frame, which is
 *  what a face mounted before the mirror has answered sees. */
const served = (): Work | undefined => works.view.byKey(ID)?.();

/** Seed the mirror and let its frames cross their streams. A subscription
 *  only runs while something reads it, so a case MOUNTS first and serves
 *  after — the same order a browser's does. */
const serve = async (work: Work): Promise<void> => {
  works.push(ID, work);
  works.pushKeys([ID]);
  members.push(REF, { work: ID, role: "planner", joinedAt: at(1_000) });
  members.pushKeys([REF]);
  await settle();
  flush();
};

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

const mount = (ui: () => JSX.Element): HTMLElement => {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <Shown value={() => true}>{ui()}</Shown>, root);
  flush();
  return root;
};

/** WHAT SOLID SAID ABOUT THIS RENDER — taken off the collector, so these
 *  cases judge the findings themselves rather than leaving them to the
 *  suite's `afterEach`, every grade kept and `info` included. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

const textOf = (host: HTMLElement, testId: string): string =>
  host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "(absent)";

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  unpickWork();
  flush();
});

/** The board's own shape: the card is drawn for the work the mirror holds,
 *  and nothing before its first frame. */
const cardOf = (shape: "card" | "picked") => () => (
  <Show when={served()}>
    {(one) => <WorkCard id={ID} work={one()} shape={shape} />}
  </Show>
);

describe("a card whose work has a long timeline", () => {
  it("draws its board face with no scope subscribed to the whole record", async () => {
    const el = mount(cardOf("card"));
    await serve(grown());

    // The card really is the one drawn, and it says where the work stands:
    // its title, its state, and the agent it is waiting on.
    const card = el.querySelector('[data-testid="work-card"]');
    expect(card?.getAttribute("data-work")).toBe(ID);
    expect(card?.getAttribute("data-state")).toBe("open");
    expect(card?.getAttribute("data-who")).toBe("agent");
    expect(textOf(el, "work-card-title")).toBe(TITLE);
    expect(findings()).toEqual([]);
  });

  it("draws its picked face — details and timeline — the same way", async () => {
    pickWork(ID);
    const el = mount(cardOf("picked"));
    await serve(ended());

    // The details really are on screen: the timeline and "where the time
    // went" are the two widest folds this case is about, and the second one
    // says the fixture's own hours.
    expect(el.querySelector('[data-testid="work-details"]')).not.toBeNull();
    expect(textOf(el, "work-time-spent")).toBe(TIME_SPENT);
    expect(findings()).toEqual([]);
  });

  it("names who it waits on from one read of the record", async () => {
    const el = mount(() => (
      <Show when={served()}>{(one) => <WorkChipFace work={one()} />}</Show>
    ));
    await serve(grown());

    const face = el.querySelector('[data-testid="work-chip-face"]');
    expect(face?.getAttribute("data-who")).toBe("agent");
    expect(textOf(el, "work-chip-title")).toBe(TITLE);
    expect(findings()).toEqual([]);
  });
});

describe("a record that moves", () => {
  it("re-folds once for one event, and the card says the new answer", async () => {
    const el = mount(cardOf("card"));
    await serve(grown());
    const card = el.querySelector('[data-testid="work-card"]');
    expect(card?.getAttribute("data-who")).toBe("agent");
    expect(findings()).toEqual([]);
    const before = folds.timeSpentOnYou;

    // THE NEXT FRAME, as the server delivers one: the same record with one
    // more event on it. The subscription writes it into its store field by
    // field, so this is the leaf write a browser would see.
    await serve(asking());

    // The card followed the record through the snapshot...
    expect(card?.getAttribute("data-who")).toBe("you");
    expect(textOf(el, "work-card-title")).toBe(TITLE);
    // ... and the fold ran ONCE for the one event, not once per leaf the
    // append moved.
    expect(folds.timeSpentOnYou - before).toBe(1);
    expect(findings()).toEqual([]);
  });
});
