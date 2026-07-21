/** Cards-mode dock width — the maximized dock's drag-to-resize footprint.
 *
 *  Its own leaf module (not folded into `Dock.tsx`) so the pure `clampDockCardsWidth`
 *  is unit-testable without evaluating the whole Dock component graph (`wire`, the
 *  surface stack, StatePip …), matching the dock folder's other tested leaves
 *  (`dockTree.ts`, `dockRowRanking.ts`, `pipVariant.ts`).
 *
 *  Persisted per-device like `dockMode` (a 13" laptop and a 27" desktop each keep
 *  their own dock width). Rail stays fixed at `RAIL_WIDTH_PX`; only cards mode is
 *  resizable. */

import { persistedPref } from "../../persistedPref";

/** Default cards width — the width the dock shipped with, and where a fresh
 *  install lands. Also the double-click-to-reset target. */
export const CARDS_WIDTH_PX = 288;

// Bounds for the user-resizable cards width. Floor keeps a row's
// `indicator · branch · pips · time` line legible; ceiling keeps the dock from
// swallowing the canvas it sits beside. The default sits inside the range.
const DOCK_CARDS_MIN_WIDTH_PX = 200;
const DOCK_CARDS_MAX_WIDTH_PX = 560;

// Canvas width to keep reserved beside the maximized dock. The 560px ceiling
// alone is a FIXED bound, blind to the room the dock actually has: the maximized
// dock is a `shrink-0` flex sibling of the terminal canvas inside an
// `overflow-hidden` host that the right-panel split can shrink well below 560px
// (a 25% right panel on a narrow desktop leaves the canvas ~480px). Without this
// reserve a stored-wide dock could squeeze the canvas to zero AND clip its own
// right-edge handle off-screen — leaving no way to drag or double-click it back.
// `effectiveDockCardsWidth` caps the RENDERED width to the host so the handle and
// a usable canvas always stay on-screen; the stored preference is untouched, so
// the dock re-widens when the host grows again.
const DOCK_CARDS_MIN_CANVAS_PX = 320;

/** Clamp a candidate cards width into the resize bounds. The drag setter and the
 *  stored-value parse both route through it, so a hand-edited `localStorage` value
 *  can't escape the range the drag handle enforces. */
export function clampDockCardsWidth(px: number): number {
  return Math.min(
    DOCK_CARDS_MAX_WIDTH_PX,
    Math.max(DOCK_CARDS_MIN_WIDTH_PX, px),
  );
}

/** The width the maximized dock should actually RENDER at, given the width of the
 *  flex host it shares with the canvas. Caps the stored `preferred` so at least
 *  `DOCK_CARDS_MIN_CANVAS_PX` stays for the canvas — which keeps the dock's
 *  right-edge resize handle on-screen and recoverable. Never drops below the
 *  width floor (an extremely narrow host is its own degenerate case, not the
 *  persisted-width trap this guards). `hostWidth <= 0` (unmeasured, first paint)
 *  falls back to the clamped preference. Pure, so the recoverability contract is
 *  unit-testable without a DOM. */
export function effectiveDockCardsWidth(
  preferred: number,
  hostWidth: number,
): number {
  const clamped = clampDockCardsWidth(preferred);
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) return clamped;
  const maxByHost = Math.max(
    DOCK_CARDS_MIN_WIDTH_PX,
    hostWidth - DOCK_CARDS_MIN_CANVAS_PX,
  );
  return Math.min(clamped, maxByHost);
}

/** Per-device cards-mode width in pixels. The serializer writes a canonical
 *  `JSON.stringify(number)` (e.g. `"288"`), so the parse mirrors it with
 *  `JSON.parse` and accepts ONLY a finite JSON number — a hand-edited `""`,
 *  `"abc"`, `"0x140"`, or `"12px"` all throw (they are not canonical JSON
 *  numbers), so nothing the serializer never writes slips through as a coerced
 *  `Number(...)` would (`Number("") === 0`). Two distinct degradations, both
 *  surfaced rather than swallowed: a non-number falls back to `CARDS_WIDTH_PX`
 *  via `onInvalid`; a finite but out-of-range number CLAMPS to the nearest
 *  bound. */
const [dockCardsWidth, setDockCardsWidthRaw] = persistedPref<number>({
  name: "kolu-dock-cards-width",
  fallback: CARDS_WIDTH_PX,
  parse: (raw) => {
    const n: unknown = JSON.parse(raw);
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`invalid dock width: ${raw}`);
    }
    return clampDockCardsWidth(n);
  },
  // Surface the corruption instead of silently resetting — the repo's
  // caught-error-must-not-collapse-to-empty rule. A benign per-device pref reset
  // warrants a console diagnostic (matching `persistedPref`'s per-host default),
  // not a toast.
  onInvalid: (err, raw) =>
    console.warn(
      `[dockCardsWidth] ignoring invalid stored width ${JSON.stringify(raw)} — falling back to ${CARDS_WIDTH_PX}`,
      err,
    ),
});

export { dockCardsWidth };

/** Set the cards width, clamped into bounds. The drag handle commits this ONCE
 *  per gesture (in `onEnd`, via Dock.tsx's local, unpersisted `dragWidth` signal
 *  — `makePersisted` has no debounce of its own, so writing on every
 *  `pointermove` would `localStorage.setItem` at 60-120×/s for the drag's
 *  duration), plus once for the double-click reset. The equality guard below
 *  still matters for both: a no-motion drag commits the unchanged start width,
 *  and a double-click at the already-default width is a no-op. Pass
 *  `CARDS_WIDTH_PX` to reset to default — no dedicated wrapper (the repo's
 *  no-thin-wrapper rule). */
export function setDockCardsWidth(px: number): void {
  const next = clampDockCardsWidth(px);
  if (next === dockCardsWidth()) return;
  setDockCardsWidthRaw(next);
}
