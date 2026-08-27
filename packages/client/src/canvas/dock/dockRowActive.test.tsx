// @vitest-environment happy-dom
/**
 * WHICH DOCK ROWS CARRY `data-active` — the whole state matrix, at the level
 * the bug actually lives.
 *
 * The dock has two canonical focus folds after FX1: `isActiveTile` answers
 * which top-level tile contains the keyboard, while `isFocused` answers which
 * terminal actually owns it. A split nests inside its parent, so both rows are
 * active while typing in that split. Keeping the matrix at the rendered-row
 * boundary makes it impossible for `isActiveRow` and its callers to quietly
 * disagree about either fold again — it renders the SAME pair the dock renders,
 * `isActiveRow` feeding `@kolu/solid-dockrow`'s `dockRowAttrs`, so the hoisted
 * read and the attribute it becomes are tested together rather than apart.
 */

import type { AgentInfo, TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "the-split" as TerminalId;
const OTHER_SPLIT = "other-split" as TerminalId;
const ELSEWHERE = "another-tile" as TerminalId;

const [activeTile, setActiveTile] = createSignal<TerminalId | null>(PARENT);
const [focusedTerminal, setFocusedTerminal] = createSignal<TerminalId | null>(
  PARENT,
);

vi.mock("../../tile/useTileStore", () => ({
  useTileStore: () => ({
    isActiveTile: (id: TerminalId) => activeTile() === id,
    isFocused: (id: TerminalId) => focusedTerminal() === id,
  }),
}));

const { dockRowAttrs } = await import("@kolu/solid-dockrow/rowValues");
const { isActiveRow } = await import("./activeRow");

/** Render both rows the way the dock does, and report who is lit. */
function litRows(
  splitAgentState: AgentInfo["state"] | undefined = "thinking",
): { parent: boolean; split: boolean } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <>
        <div
          data-role="parent"
          {...dockRowAttrs({
            id: PARENT,
            bucket: "idle",
            agentState: undefined,
            pip: { asking: false, alert: false },
            active: isActiveRow(PARENT),
          })}
        />
        <div
          data-role="split"
          {...dockRowAttrs({
            id: SPLIT,
            bucket: splitAgentState ? "working" : "idle",
            agentState: splitAgentState,
            pip: { asking: false, alert: false },
            active: isActiveRow(SPLIT),
          })}
        />
      </>
    ),
    host,
  );
  const read = (role: string) =>
    host.querySelector(`[data-role="${role}"]`)?.hasAttribute("data-active") ??
    false;
  const out = { parent: read("parent"), split: read("split") };
  dispose();
  host.remove();
  return out;
}

beforeEach(() => {
  setActiveTile(PARENT);
  setFocusedTerminal(PARENT);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("data-active across the dock's row states", () => {
  it("lights the parent of a terminal with a split you have never opened", () => {
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights the parent while focus is in the main pane", () => {
    setFocusedTerminal(PARENT);
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights BOTH when you are typing in the split — they nest", () => {
    setFocusedTerminal(SPLIT);
    expect(litRows()).toEqual({ parent: true, split: true });
  });

  it("lights an agentless split by the same focus fact", () => {
    setFocusedTerminal(SPLIT);
    expect(litRows(undefined)).toEqual({ parent: true, split: true });
  });

  it("lights only the parent when a SIBLING split holds focus", () => {
    setFocusedTerminal(OTHER_SPLIT);
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights only the parent when the panel is collapsed", () => {
    // Collapsing sends focus back to the parent but leaves its tile active.
    setFocusedTerminal(PARENT);
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights nothing when you are looking at a different tile", () => {
    setActiveTile(ELSEWHERE);
    setFocusedTerminal(ELSEWHERE);
    expect(litRows()).toEqual({ parent: false, split: false });
  });

  it("lights nothing when no tile is selected at all", () => {
    setActiveTile(null);
    setFocusedTerminal(null);
    expect(litRows()).toEqual({ parent: false, split: false });
  });
});
