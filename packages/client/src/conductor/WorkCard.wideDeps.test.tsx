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
 * The fixture is a work whose timeline is the length the lane's own works
 * reach. The children that are not this card's own reading are stubbed:
 * what each of them subscribes is its own subject, not this one's.
 */

import {
  ABOUT_WORK,
  endWork,
  joinWork,
  openWork,
  type RecordableEvent,
  recordEvent,
  type Work,
  type WorkEvent,
  type WorkId,
  workIdOf,
} from "kolu-work";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAdvisorySolidDiagnostic,
  takeSolidDiagnostics,
} from "@kolu/solid-test-setup/setup";

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({ kind: "gone" }),
}));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map(),
  useWorkMembers: () => () => new Map(),
  useWorkPrs: () => () => new Map(),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
// `WorkCardActions` is NOT mocked: its own fold over the record
// (`needsYouOf`) is one of the scopes this file judges, and it is drawn on
// the board face below.
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));
vi.mock("./WorkSubtitle", () => ({ default: () => <p /> }));

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

import { Shown } from "../ui/shown";
import WorkCard from "./WorkCard";
import WorkChipFace from "./WorkChipFace";
import { pickWork, unpickWork } from "./workListing";

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "long-record",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const MEMBER = { kind: "member", terminal: "t" } as const;

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
    title: "A work with a long timeline",
    at: at(0),
    request: { kind: "none" },
  });
  work = joinWork(work, { terminal: "t", role: "planner", at: at(1_000) });
  for (let i = 0; i < ROUNDS; i++)
    for (const one of round(i)) work = recordEvent(work, one);
  return work;
};

const ended = (): Work =>
  endWork(grown(), {
    outcome: { kind: "stopped", by: "you" },
    at: at(ROUNDS * 60_000 + 10_000),
  });

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
 *  suite's `afterEach`, and name the scope when one is raised. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  unpickWork();
});

describe("a card whose work has a long timeline", () => {
  it("draws its board face with no scope subscribed to the whole record", () => {
    const [work] = createStore(grown());

    mount(() => <WorkCard id={ID} work={work} shape="card" />);

    expect(findings()).toEqual([]);
  });

  it("draws its picked face — details and timeline — the same way", () => {
    const [work] = createStore(ended());
    pickWork(ID);

    const el = mount(() => <WorkCard id={ID} work={work} shape="picked" />);

    // The details really are on screen: the timeline and "where the time
    // went" are the two widest folds this case is about.
    expect(el.querySelector('[data-testid="work-details"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="work-time-spent"]')).not.toBeNull();
    expect(findings()).toEqual([]);
  });

  it("names who it waits on from one read of the record", () => {
    const [work] = createStore(grown());

    const el = mount(() => <WorkChipFace work={work} />);

    expect(
      el
        .querySelector('[data-testid="work-chip-face"]')
        ?.getAttribute("data-who"),
    ).not.toBeNull();
    expect(findings()).toEqual([]);
  });
});

describe("a record that moves", () => {
  it("re-folds once for one event, and the card says the new answer", () => {
    const [work, setWork] = createStore(grown());
    const el = mount(() => <WorkCard id={ID} work={work} shape="card" />);
    const card = el.querySelector('[data-testid="work-card"]');
    expect(card?.getAttribute("data-who")).not.toBe("you");
    const before = folds.timeSpentOnYou;

    setWork((draft: Work) => {
      (draft.events as WorkEvent[]).push({
        at: at(ROUNDS * 60_000 + 7_000),
        by: "agent",
        about: { ...MEMBER },
        kind: "question",
        ask: "the last word",
      });
    });
    flush();

    // The card followed the record through the snapshot...
    expect(card?.getAttribute("data-who")).toBe("you");
    // ... and the fold ran ONCE for the one event, not once per leaf the
    // append moved.
    expect(folds.timeSpentOnYou - before).toBe(1);
    expect(findings()).toEqual([]);
  });
});
