// @vitest-environment happy-dom
/**
 * THE ONE STATUS LINE, as a person meets it: the state word the header chip
 * used to carry, what the conversation is doing and for how long, the
 * `watching N` that opens the list, and the waiting count that is ABSENT at
 * zero rather than rendering its own silence.
 *
 * The watched panel is stubbed here on purpose: it reads the live fleet (and
 * through `ConductorLook`, the padi wire), which is a different test's
 * subject. What this file pins is that pressing the button is what puts it on
 * screen, and pressing it again takes it away.
 */

import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorRow,
  type ConductorState,
} from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ConductorWatchedPanel", () => ({
  default: () => <div data-testid="conductor-watched-panel" />,
}));

import ConductorStatus from "./ConductorStatus";
import { Shown } from "../ui/shown";

const SINCE = "2026-01-01T00:00:00.000Z";

/** When a piece of work's first terminal joined the watch list. The status
 *  line counts pieces of work rather than ageing them, so any instant does —
 *  the panel that DRAWS the age is stubbed out above. */
const WATCHED_SINCE = "2026-01-01T09:00:00.000Z";

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
      // The pane is a retained view; every part of it reads its visibility
      // from this context, so a status line mounted for a test says it is
      // being looked at.
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
    // Seconds, ticking from the instant the turn began.
    expect(at("conductor-status-since")?.textContent).toMatch(/^\d+s$/);
  });

  it("carries no clock while nothing is running", () => {
    const at = mount({ phase: "idle", busySince: null });
    expect(at("conductor-status-since")).toBeUndefined();
    expect(at("conductor-status-detail")).toBeUndefined();
  });

  it("says how many pieces of work are in flight and how many terminals that is, and opens the list on a press", () => {
    const at = mount({
      work: [
        {
          root: "local/a",
          name: "fix-parser",
          refs: ["local/a", "local/b"],
          since: WATCHED_SINCE,
        },
        {
          root: "local/c",
          name: "docs-pass",
          refs: ["local/c"],
          since: WATCHED_SINCE,
        },
      ],
    });
    const button = at("conductor-watching");
    // The words a person reads, and the same two numbers as data for anything
    // that should not have to parse English.
    expect(button?.textContent?.replace(/\s+/g, " ")).toBe(
      "2 pieces of work · 3 terminals",
    );
    expect(button?.dataset.work).toBe("2");
    expect(button?.dataset.terminals).toBe("3");
    expect(at("conductor-watched-panel")).toBeUndefined();

    button?.click();
    expect(at("conductor-watched-panel")).toBeDefined();
    expect(button?.getAttribute("aria-expanded")).toBe("true");

    button?.click();
    expect(at("conductor-watched-panel")).toBeUndefined();
  });

  it("says one piece of work and one terminal in the singular", () => {
    const at = mount({
      work: [
        {
          root: "local/a",
          name: "fix-parser",
          refs: ["local/a"],
          since: WATCHED_SINCE,
        },
      ],
    });
    expect(at("conductor-watching")?.textContent?.replace(/\s+/g, " ")).toBe(
      "1 piece of work · 1 terminal",
    );
  });

  it("says NOTHING when nothing is watched — no count, and no control", () => {
    // `watching 0` and a press that opened an empty panel were both readouts
    // of nothing. The line simply does not carry them.
    const at = mount({ work: [] });
    expect(at("conductor-watching")).toBeUndefined();
    expect(at("conductor-watched-panel")).toBeUndefined();
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
    // The hint had a row of its own under the composer. It lives on the line
    // that reports the running turn now, and it is still true exactly when
    // the chord works: a conversation that steers, with a turn in flight.
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
