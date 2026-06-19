import type { TerminalId } from "kolu-common/surface";

/** Max concurrent WebGL contexts kolu holds across all tiles. Two forces set it:
 *
 *  1. **Chrome's per-tab WebGL limit** — measured 16 on Chrome 148. Exceeding it
 *     makes Chrome evict the oldest context ("Too many active WebGL contexts"),
 *     which blanks terminals for ~3s and balloons tab memory (#575, #591).
 *  2. **Renderer reflow** — the WebGL and DOM renderers measure cell width
 *     differently (WebglRenderer floors `charW × dpr`), so a tile that *swaps*
 *     between them reflows its text ~7.7% (#1306; #1400 cause #1; upstream won't
 *     reconcile, xtermjs/xterm.js#6015). A tile keeps WebGL across focus changes
 *     only while it stays admitted, so the swap never happens to admitted tiles.
 *
 *  This was a fixed 2 tiles (#1403/#1404, chosen for the A↔B reflow). But a
 *  budget *smaller than the working set* destroys+recreates a WebGL context on
 *  every focus switch across more terminals, and on Chrome+AMD a torn-down
 *  context's VRAM is reclaimed only at JS GC — so sustained focus-churn outruns
 *  GC, VRAM climbs to exhaustion, and the GPU faults (#1399). The fix is to admit
 *  the whole working set churn-free, capped (with margin) below the measured 16 —
 *  the "real cap management" #1404 noted a larger budget would need. Live
 *  contexts don't leak over time (measured flat under sustained focus cycling),
 *  so a higher cap only raises a bounded steady-state baseline, not a leak. */
export const WEBGL_CONTEXT_CAP = 12;

/** The minimal slice of a tile's sub-panel state that determines its WebGL
 *  footprint — pure booleans/ids, no SolidJS store, so the cost model is
 *  node-testable in isolation. */
interface PanelWebglShape {
  collapsed: boolean;
  activeSubTab: TerminalId | null;
}

/** Does this tile have an expanded, active split? The single home for the
 *  split-cost axis (#1399): a split that is collapsed is invisible and holds no
 *  context, an expanded one with an active sub-tab does. Both `tileWebglCost`
 *  and the store's `holdsWebgl` build on this one sub-fact, so the budgeted
 *  count and the per-terminal grant can't drift apart. */
function hasActiveSplit(panel: PanelWebglShape): boolean {
  return !panel.collapsed && panel.activeSubTab !== null;
}

/** Whether `childId` is the tile's expanded, active split — i.e. the one
 *  sub-terminal that inherits the tile's WebGL slot. */
export function isActiveSplit(
  panel: PanelWebglShape,
  childId: TerminalId,
): boolean {
  return hasActiveSplit(panel) && panel.activeSubTab === childId;
}

/** A tile's WebGL-context cost: 1 for its main pane, +1 for an expanded, active
 *  split — the quantity `admitWebglTiles` counts against the cap (#575). Built on
 *  `hasActiveSplit`, so it stays in lockstep with the per-terminal grant. */
export function tileWebglCost(panel: PanelWebglShape): number {
  return 1 + (hasActiveSplit(panel) ? 1 : 0);
}

/** Greedily admit `ordered` tiles (most-recently-active first) until the next
 *  one would push the running `costOf` total past `cap` (cost per tile comes from
 *  `tileWebglCost`). Pure (no SolidJS / DOM) so the #1399 cap policy — admit the
 *  whole working set, but never overflow Chrome's per-tab limit — is
 *  unit-testable in isolation. */
export function admitWebglTiles(
  ordered: readonly TerminalId[],
  costOf: (id: TerminalId) => number,
  cap: number,
): TerminalId[] {
  const held: TerminalId[] = [];
  let contexts = 0;
  for (const id of ordered) {
    const cost = costOf(id);
    if (contexts + cost > cap) break;
    held.push(id);
    contexts += cost;
  }
  return held;
}
