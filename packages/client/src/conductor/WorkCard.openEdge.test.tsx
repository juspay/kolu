// @vitest-environment happy-dom
/**
 * WHAT A CARD SHOWS OF ITS TIMELINE, ROUND AFTER ROUND OF PICKING IT.
 *
 * A picked work shows the stage its map was pressed on (and, on the trail,
 * the whole timeline when that is asked for); unpicking it forgets both, so
 * the next pick follows the work again. That forgetting is keyed on the pick
 * itself — the very fact `shownStage()` and the timeline read — so written
 * from an effect's apply arm it RELAYS the unpick: everything reading the
 * pick runs once against the stale press and again once the reset lands,
 * which Solid grades `EFFECT_RELAY_TEAR` and warns about from the third
 * sighting. Three rounds of pick / press / unpick therefore judge BOTH: what
 * the map and the timeline show after each gesture, and that Solid said
 * nothing at all about the render.
 *
 * The work arrives over the real collection mirror, as a board row's does.
 */

import {
  ABOUT_WORK,
  askQuestions,
  joinWork,
  openWork,
  type RecordableEvent,
  recordEvent,
  type Work,
  type WorkId,
  type WorkMember,
  WORK_MODES,
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

// The collections this card reads, as the client binds them; the rest of the
// wire is inert, since nothing this card draws dials a host.
vi.mock("../wire", async () => {
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
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));

import { settle } from "@kolu/surface/solid/testlib";
import { Shown } from "../ui/shown";
import { collectionMirror } from "./collectionMirror.testlib";
import WorkCard from "./WorkCard";
import { pickWork, unpickWork } from "./workListing";

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const HOST = "local";
const TERMINAL = "t";
const REF = `${HOST}/${TERMINAL}`;
const TITLE = "A work whose timeline is pressed on";
const KEY = {
  kind: "branch",
  host: HOST,
  repo: "/r",
  branch: "pressed",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const MEMBER = { kind: "member", terminal: TERMINAL } as const;

/** A work that has reached several stages, so its map has more than one box
 *  to press: the agent worked, a file landed, and the forge answered. */
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
    title: TITLE,
    at: at(0),
    request: { kind: "none" },
  });
  // THE MODE, as the request gives one: a waterfall work has stages, and a
  // work whose mode nobody answered has none for a map to draw.
  work = askQuestions(work, {
    ask: "setup",
    at: at(500),
    questions: [
      {
        id: "mode",
        question: "How should this run?",
        topic: "setup",
        key: "mode",
        options: [...WORK_MODES],
        given: { kind: "given", value: "full" },
      },
    ],
  });
  work = joinWork(work, { terminal: TERMINAL, role: "planner", at: at(1_000) });
  work = joinWork(work, {
    terminal: `${TERMINAL}i`,
    role: "implementor",
    at: at(2_500),
  });
  for (const one of TIMELINE) work = recordEvent(work, one);
  return work;
};

/** THE MIRRORS, as the client binds them: the real per-key collection view
 *  over real subscription stores. */
const works = collectionMirror<WorkId, Work>("works");
const members = collectionMirror<string, WorkMember>("workMembers");
held.works = works.view;
held.members = members.view;
held.empty = collectionMirror<string, never>("empty").view;

const served = (): Work | undefined => works.view.byKey(ID)?.();

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

/** WHAT SOLID SAID ABOUT THIS RENDER — every grade kept, `info` included. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  unpickWork();
  flush();
});

const card = () => (
  <Show when={served()}>
    {(one) => <WorkCard id={ID} work={one()} shape="picked" />}
  </Show>
);

/** The pressable stage boxes of the map: the stage name and its own button,
 *  which carries whether the timeline shows that stage. */
const boxes = (
  el: HTMLElement,
): ReadonlyArray<{ readonly stage: string; readonly cell: HTMLElement }> =>
  [...el.querySelectorAll('[data-testid="stage-map"] [data-testid="stage"]')]
    .map((one) => ({
      stage: one.getAttribute("data-stage") ?? "",
      cell: one.querySelector<HTMLElement>('[data-testid="stage-cell"]'),
    }))
    .flatMap((one) =>
      one.cell === null ? [] : [{ stage: one.stage, cell: one.cell }],
    );

/** THE STAGE THE MAP SAYS IS SHOWN — the pressed box, by name, or none. */
const shownStage = (el: HTMLElement): string | undefined =>
  boxes(el).find((one) => one.cell.getAttribute("aria-pressed") === "true")
    ?.stage;

/** Press a stage on the map. */
const pressStage = (el: HTMLElement, stage: string): void => {
  const box = boxes(el).find((one) => one.stage === stage);
  if (box === undefined) throw new Error(`no pressable stage box: ${stage}`);
  box.cell.click();
  flush();
};

/** Every stage the map offers to press, in order. */
const stageNames = (el: HTMLElement): ReadonlyArray<string> =>
  boxes(el).map((one) => one.stage);

/** Is the whole timeline out? The trail's own unfold says so. */
const wholeOut = (el: HTMLElement): boolean =>
  el
    .querySelector('[data-testid="work-timeline-whole"]')
    ?.getAttribute("aria-expanded") === "true";

describe("a work picked, pressed on and unpicked, round after round", () => {
  it("shows the pressed stage while it is picked and follows the work again once it is not", async () => {
    const el = mount(card);
    await serve(staged());

    // Nothing is picked yet: the board face draws no stage as shown.
    expect(shownStage(el)).toBeUndefined();
    expect(findings()).toEqual([]);

    const stages = (() => {
      pickWork(ID);
      flush();
      const names = stageNames(el);
      unpickWork();
      flush();
      takeSolidDiagnostics();
      return names;
    })();
    // The map has boxes to press, and one of them is not the stage the work
    // itself is in — so a press really moves what is shown.
    expect(stages.length).toBeGreaterThan(1);

    for (const round of [1, 2, 3]) {
      pickWork(ID);
      flush();
      // A fresh pick follows the WORK: the stage it is in, never the one a
      // previous round pressed.
      const followed = shownStage(el);
      expect(followed, `round ${round}: picked follows the work`).toBe(
        stages.at(-1),
      );
      expect(findings(), `round ${round}: pick`).toEqual([]);

      // A press on another stage moves what the timeline shows...
      const other = stages.find((name) => name !== followed) ?? "";
      pressStage(el, other);
      expect(shownStage(el), `round ${round}: pressed stage`).toBe(other);
      expect(wholeOut(el), `round ${round}: pressed keeps the fold`).toBe(
        false,
      );
      expect(findings(), `round ${round}: press`).toEqual([]);

      // ... and unpicking forgets it, with nothing drawn as shown.
      unpickWork();
      flush();
      expect(shownStage(el), `round ${round}: unpicked shows nothing`).toBe(
        undefined,
      );
      expect(findings(), `round ${round}: unpick`).toEqual([]);
    }
  });

  it("forgets the whole timeline on an unpick, round after round", async () => {
    const el = mount(card);
    await serve(staged());
    takeSolidDiagnostics();

    for (const round of [1, 2, 3]) {
      pickWork(ID);
      flush();
      expect(wholeOut(el), `round ${round}: picked is folded`).toBe(false);
      expect(findings(), `round ${round}: pick`).toEqual([]);

      el.querySelector<HTMLElement>(
        '[data-testid="work-timeline-whole"]',
      )?.click();
      flush();
      expect(wholeOut(el), `round ${round}: whole is out`).toBe(true);
      expect(findings(), `round ${round}: whole`).toEqual([]);

      unpickWork();
      flush();
      expect(findings(), `round ${round}: unpick`).toEqual([]);
    }
  });
});
