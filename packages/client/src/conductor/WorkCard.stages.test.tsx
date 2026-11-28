// @vitest-environment happy-dom
/**
 * A CARD'S STAGES SURVIVE THE REST OF THE WORK MOVING.
 *
 * The stages are a fold over the whole record and the clock — every cell,
 * every filing and every visit minted fresh on each run — and the card hands
 * that one reading to its map, its trail and its timeline. A leaf of the work
 * that the stages do not read (its title) must therefore not redraw them: the
 * map's boxes stay the elements they were, and the reading publishes once.
 *
 * The leaf is written on the STORE the card is given, through `WorkCard`, so
 * what is judged is the card's own path from the proxy to its snapshot.
 */

import {
  ABOUT_WORK,
  joinWork,
  openWork,
  type RecordableEvent,
  recordEvent,
  type Work,
  type WorkId,
  workIdOf,
} from "kolu-work";
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
  // No records in this fixture: a card's work arrives as a prop here.
  useWorkAt: () => undefined,
  useWorkMembers: () => () => new Map(),
  useWorkPrs: () => () => new Map(),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));
vi.mock("./WorkSubtitle", () => ({ default: () => <p /> }));

import { Shown } from "../ui/shown";
import WorkCard from "./WorkCard";
import { unpickWork } from "./workListing";

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "staged",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const MEMBER = { kind: "member", terminal: "t" } as const;

/** A work that has reached several stages: the agent worked, files landed,
 *  and the forge answered about the branch. */
const TIMELINE: ReadonlyArray<RecordableEvent> = [
  {
    at: at(2_000),
    by: "kolu",
    about: { ...MEMBER },
    kind: "ready",
    why: { kind: "none" },
  },
  {
    at: at(3_000),
    by: "agent",
    about: { ...MEMBER },
    kind: "file",
    path: "src/a.ts",
  },
  {
    at: at(4_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-running",
    pr: 7,
    head: { kind: "commit", sha: "sha0" },
    failing: [],
  },
  {
    at: at(5_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-passed",
    pr: 7,
    head: { kind: "commit", sha: "sha0" },
    failing: [],
  },
];

const staged = (): Work => {
  let work = openWork({
    key: KEY,
    title: "A work with stages",
    at: at(0),
    request: { kind: "none" },
  });
  work = joinWork(work, { terminal: "t", role: "planner", at: at(1_000) });
  for (const one of TIMELINE) work = recordEvent(work, one);
  return work;
};

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  unpickWork();
});

/** What Solid said about this render, the advisories left out. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

const boxes = (el: HTMLElement): ReadonlyArray<HTMLElement> => [
  ...el.querySelectorAll<HTMLElement>('[data-testid="stage"]'),
];

describe("a card whose work is renamed", () => {
  it("keeps its stage boxes while the title is written five times", () => {
    const [work, setWork] = createStore(staged());
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(
      () => (
        <Shown value={() => true}>
          <WorkCard id={ID} work={work} shape="card" />
        </Shown>
      ),
      root,
    );
    flush();
    const before = boxes(el);
    expect(before.length).toBeGreaterThan(0);
    takeSolidDiagnostics();

    // Five, not four: the diagnostic names a memo at four equal publishes.
    for (let read = 1; read <= 5; read += 1) {
      setWork((draft: Work) => {
        // A `Work`'s leaves are readonly to a reader; the store's draft is
        // where one is written.
        const writable = draft as { title: string };
        writable.title = `A work with stages (${read})`;
      });
      flush();
    }

    // The card followed the title...
    expect(
      el.querySelector('[data-testid="work-card-title"]')?.textContent,
    ).toBe("A work with stages (5)");
    // ... and the stages it did not touch are the same boxes, read once.
    const after = boxes(el);
    expect(after).toHaveLength(before.length);
    expect(after.every((one, index) => one === before[index])).toBe(true);
    expect(findings()).toEqual([]);
  });
});
