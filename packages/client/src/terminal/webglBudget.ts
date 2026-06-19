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

/** Greedily admit `ordered` tiles (most-recently-active first) until the next
 *  one would push live WebGL contexts past `cap`. `costOf(id)` is a tile's
 *  context cost: 1 for its main pane, +1 for an expanded, active split. Pure (no
 *  SolidJS / DOM) so the #1399 cap policy — admit the whole working set, but
 *  never overflow Chrome's per-tab limit — is unit-testable in isolation. */
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
