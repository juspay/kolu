// @vitest-environment happy-dom
import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorRow,
  type ConductorState,
} from "kolu-common/conductor";
import { needsYou, type WorkRow } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./WorkColumn", () => ({
  default: () => <div data-testid="work-column" />,
}));

let works: WorkRow[] = [];
vi.mock("./useWorks", () => ({
  useWorks: () => () => works,
  useNeedsYou: () => () => needsYou(works),
}));

import ConductorStatus from "./ConductorStatus";
import { Shown } from "../ui/shown";

const SINCE = "2026-01-01T00:00:00.000Z";

const work = (branch: string, title: string): WorkRow => [
  `branch:local/%2Fcode%2Fkolu/${branch}`,
  {
    key: { kind: "branch", host: "local", repo: "/code/kolu", branch },
    title,
    events: [],
    decisions: [],
    startedAt: "2026-01-01T09:00:00.000Z",
    state: { kind: "open" },
  },
];

const agentRow = (text: string): ConductorRow => ({
  id: "a",
  seq: 1,
  since: SINCE,
  kind: "agent",
  text,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  works = [];
});

function mount(
  over: Partial<ConductorState> = {},
  rows: readonly ConductorRow[] = [],
): (testid: string) => HTMLElement | undefined {
  root = document.createElement("div");
  document.body.append(root);
  const state: ConductorState = { ...DEFAULT_CONDUCTOR_STATE, ...over };
  dispose = render(
    () => (
      <Shown.Provider value={() => true}>
        <ConductorStatus state={state} rows={rows} />
      </Shown.Provider>
    ),
    root,
  );
  return (testid) =>
    root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;
}

describe("the status line", () => {
  it("says the phase in the words the header chip used", () => {
    const at = mount({ phase: "idle" });
    expect(at("conductor-phase")?.textContent).toBe("idle");
    expect(at("conductor-status")?.dataset.phase).toBe("idle");
  });

  it("says what it is doing, and for how long, while it works", () => {
    const at = mount(
      {
        phase: "working",
        busySince: new Date(Date.now() - 5_000).toISOString(),
      },
      [agentRow("briefing the planner")],
    );
    expect(at("conductor-phase")?.textContent).toBe("working");
    expect(at("conductor-status-detail")?.textContent).toBe(
      "briefing the planner",
    );
    expect(at("conductor-status-since")?.textContent).toMatch(/^\d+s$/);
  });

  it("carries no clock while nothing is running", () => {
    const at = mount({ phase: "idle", busySince: null });
    expect(at("conductor-status-since")).toBeUndefined();
    expect(at("conductor-status-detail")).toBeUndefined();
  });

  it("says how many pieces of work are in flight, and opens the column on a press", () => {
    works = [work("w1", "fix-parser"), work("w2", "docs-pass")];
    const at = mount();
    const button = at("conductor-work-count");
    expect(button?.textContent?.replace(/\s+/g, " ")).toBe("2 pieces of work");
    expect(button?.dataset.work).toBe("2");
    expect(button?.dataset.waiting).toBeUndefined();
    expect(at("work-column")).toBeUndefined();

    button?.click();
    expect(at("work-column")).toBeDefined();
    expect(button?.getAttribute("aria-expanded")).toBe("true");

    button?.click();
    expect(at("work-column")).toBeUndefined();
  });

  it("says one piece of work in the singular", () => {
    works = [work("w1", "fix-parser")];
    const at = mount();
    expect(at("conductor-work-count")?.textContent?.replace(/\s+/g, " ")).toBe(
      "1 piece of work",
    );
  });

  it("counts a question about no work as something waiting on you", () => {
    works = [work("w1", "fix-parser")];
    const at = mount({ openAsks: ["ask-1"] });
    const button = at("conductor-work-count");
    expect(button?.textContent?.replace(/\s+/g, " ")).toBe(
      "1 piece of work · 1 needs you",
    );
    expect(button?.dataset.waiting).toBe("1");
  });

  it("says NOTHING with no work and nothing waiting — no count, no control", () => {
    const at = mount();
    expect(at("conductor-work-count")).toBeUndefined();
    expect(at("work-column")).toBeUndefined();
    expect(at("conductor-status")?.textContent).not.toContain("0");
  });

  it("says how many events are waiting, and nothing at all at zero", () => {
    expect(mount({ held: [] })("conductor-held")).toBeUndefined();
    dispose?.();
    root?.remove();

    const at = mount({ held: ["local/a", "local/b", "local/c"] });
    expect(at("conductor-held")?.textContent).toContain("3");
  });

  it("carries the steer hint only while steering is on offer", () => {
    expect(
      mount({ steers: true, phase: "idle" })("conductor-steer-hint"),
    ).toBeUndefined();
    dispose?.();
    root?.remove();

    expect(
      mount({ steers: false, phase: "working" })("conductor-steer-hint"),
    ).toBeUndefined();
    dispose?.();
    root?.remove();

    const at = mount({ steers: true, phase: "working" });
    expect(at("conductor-steer-hint")?.textContent).toContain("steers");
  });
});
