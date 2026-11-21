// @vitest-environment happy-dom
/**
 * A WORK'S CHIP, wherever it is drawn: its terminals' marks (three, then a
 * count), its PR's marks without a link of their own (a chip sits inside a
 * button), and the violet wait chip only while the work waits on you.
 */

import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import type { Work, WorkId } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { StandingLine } from "./workReadings";

const NOW = Date.parse("2026-01-01T00:10:00Z");

const world = vi.hoisted(() => ({
  members: 0,
  pr: null as unknown,
  who: "agent" as string,
}));

vi.mock("./workFacts", () => ({
  createWorkFacts: () => ({
    members: () =>
      Array.from({ length: world.members }, (_, i) => ({
        terminal: `local/${i}`,
        split: { host: "local", id: `t${i}` },
        standing: undefined,
      })),
    livePr: () => world.pr,
    checks: () => Option.none(),
    at: (): StandingLine => ({
      who: world.who as StandingLine["who"],
      lead: "",
      what: Option.none(),
      since: "2026-01-01T00:04:00Z",
      clock: "for",
    }),
  }),
}));
vi.mock("./MemberPip", () => ({
  default: () => <span data-testid="member-pip-stub" />,
}));
vi.mock("../ui/shown", async (actual) => ({
  ...(await actual<typeof import("../ui/shown")>()),
  useShownClock: () => () => NOW,
}));

import WorkChipFace from "./WorkChipFace";

const WORK = { title: "Add CSV export" } as Work;

const PR: PrInfo = {
  number: 412,
  title: "Add CSV export",
  state: "open",
  url: "https://example.test/pull/412",
  checks: "fail",
  checkRuns: [],
  reviewDecision: null,
  mergeStateStatus: "UNKNOWN",
  headSha: null,
  isDraft: false,
};

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());
beforeEach(() => {
  world.members = 0;
  world.pr = null;
  world.who = "agent";
});

function mount(): HTMLElement {
  const host = document.createElement("div");
  dispose = render(
    () => (
      <Shown.Provider value={() => true}>
        <WorkChipFace id={"w" as WorkId} work={WORK} />
      </Shown.Provider>
    ),
    host,
  );
  return host;
}

const part = (el: HTMLElement, id: string) =>
  el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`);

describe("a work's chip", () => {
  it("draws three terminal marks, then counts the rest", () => {
    world.members = 4;
    const el = mount();
    expect(part(el, "member-pip-stub")).toHaveLength(3);
    expect(part(el, "member-marks-more")[0]?.textContent).toBe("+1");
  });

  it("draws the PR's marks with no link and no tooltip of their own", () => {
    world.pr = PR;
    const el = mount();
    const pr = part(el, "work-chip-pr")[0];
    expect(pr).toBeDefined();
    expect(el.querySelector("a")).toBeNull();
    // The chip's hover card is the one thing that opens over it.
    expect(pr?.closest("[title]")).toBeNull();
  });

  it("carries the wait chip only while the work waits on you", () => {
    expect(part(mount(), "work-chip-wait")).toHaveLength(0);
    dispose?.();
    world.who = "you";
    expect(part(mount(), "work-chip-wait")[0]?.textContent).toBe("6m");
  });
});
