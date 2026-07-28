// @vitest-environment happy-dom
/**
 * WHICH DOCK ROWS CARRY `data-active` — the whole state matrix, at the level
 * the bug actually lives.
 *
 * Three regressions have now shipped in this one attribute, and every one of
 * them slipped past a green unit suite because the tests sat one level too low:
 * they exercised a pure resolver while the defect was in what the ROWS RENDER —
 * the composition of two derivations, the sub-panel store's seeded defaults,
 * and the OR between them. The three:
 *
 *   1. the split entry hardcoded `active: false`, so clicking into a split lit
 *      nothing;
 *   2. reading focus called the SEEDING accessor, so a terminal that merely
 *      HAD a split reported "you are in the split" and its parent row went
 *      dark;
 *   3. treating the two facts as exclusive took `data-active` off the parent
 *      whenever focus was in its split — which the dock's oldest e2e contract
 *      denies, and which a user hit immediately.
 *
 * So this file enumerates every combination rather than sampling it. The rule
 * it pins: a row is active when it IS the selected tile, OR when it is the
 * split your keyboard is in. Those nest — you are in that split, inside that
 * tile — so BOTH can be lit at once, and the parent's highlight never depends
 * on where focus went inside it.
 */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "the-split" as TerminalId;
const OTHER_SPLIT = "other-split" as TerminalId;
const ELSEWHERE = "another-tile" as TerminalId;

const [activeTile, setActiveTile] = createSignal<TerminalId | null>(PARENT);

vi.mock("../../tile/useTileStore", () => ({
  useTileStore: () => ({ activeId: activeTile }),
}));

const { dockRowAttrs } = await import("./dockRowAttrs");
const { useSubPanel } = await import("../../terminal/useSubPanel");

/** Render both rows the way the dock does, and report who is lit. */
function litRows(): { parent: boolean; split: boolean } {
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
            asking: false,
            unread: false,
          })}
        />
        <div
          data-role="split"
          {...dockRowAttrs({
            id: SPLIT,
            bucket: "working",
            agentState: "thinking",
            asking: false,
            unread: false,
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
  useSubPanel().removePanel(PARENT);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("data-active across the dock's row states", () => {
  it("lights the parent of a terminal with a split you have never opened", () => {
    // REGRESSION 2. No panel state exists. The store seeds `focusTarget:
    // "sub"` on first touch, so anything that reached for the seeding
    // accessor claimed the split for a terminal the user was plainly in.
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights the parent while focus is in the main pane", () => {
    const panel = useSubPanel();
    panel.expandPanel(PARENT);
    panel.setActiveSubTab(PARENT, SPLIT);
    panel.setFocusTarget(PARENT, "main");
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights BOTH when you are typing in the split — they nest", () => {
    // REGRESSION 3. The parent stays lit because its TILE is still the
    // selection; the split lights because that is where the keyboard is.
    const panel = useSubPanel();
    panel.expandPanel(PARENT);
    panel.setActiveSubTab(PARENT, SPLIT);
    panel.setFocusTarget(PARENT, "sub");
    expect(litRows()).toEqual({ parent: true, split: true });
  });

  it("lights only the parent when a SIBLING split holds focus", () => {
    const panel = useSubPanel();
    panel.expandPanel(PARENT);
    panel.setActiveSubTab(PARENT, OTHER_SPLIT);
    panel.setFocusTarget(PARENT, "sub");
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights only the parent when the panel is collapsed", () => {
    // `focusTarget` remembers a choice made before collapsing; there is no
    // visible pane to be focused in until it reopens.
    const panel = useSubPanel();
    panel.expandPanel(PARENT);
    panel.setActiveSubTab(PARENT, SPLIT);
    panel.setFocusTarget(PARENT, "sub");
    panel.collapsePanel(PARENT);
    // The TILE is still the selection, so the parent row stays lit — only the
    // split entry goes quiet.
    expect(litRows()).toEqual({ parent: true, split: false });
  });

  it("lights nothing when you are looking at a different tile", () => {
    const panel = useSubPanel();
    panel.expandPanel(PARENT);
    panel.setActiveSubTab(PARENT, SPLIT);
    panel.setFocusTarget(PARENT, "sub");
    setActiveTile(ELSEWHERE);
    expect(litRows()).toEqual({ parent: false, split: false });
  });

  it("lights nothing when no tile is selected at all", () => {
    setActiveTile(null);
    expect(litRows()).toEqual({ parent: false, split: false });
  });
});
