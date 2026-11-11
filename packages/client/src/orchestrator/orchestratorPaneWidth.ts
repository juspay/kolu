/** How wide the conversation is — the chat/peek split, as a number somebody
 *  chose.
 *
 *  The split used to be `flex-[1.15]` against the peek's `flex-1`: a ratio
 *  picked once, for one screen, with no way to move it. But the two halves are
 *  read for different things — the chat is prose at chat scale, the peek is a
 *  terminal whose usable width is a column count — and which one needs the room
 *  changes by the minute. So it is a width, it has a grip, and it is remembered.
 *
 *  PER DEVICE, the `dockCardsWidth` idiom it copies wholesale: a width is a fact
 *  about the screen you are sitting at, not about a host, and it costs no
 *  `Preferences` schema rung.
 *
 *  The bounds are MINIMA, not a ratio. The split used to stop at half the row
 *  (a 760px ceiling here, a `max-width: 60%` at the render), which is exactly
 *  wrong for how the two halves are read: reading a long answer wants the chat
 *  to take nearly the whole window, and watching a terminal wants the peek to.
 *  So each side keeps only what it cannot be used without, and everything
 *  between the two is free. */

import { persistedPref } from "../persistedPref";

/** Default chat width — where a fresh install lands, and the double-click
 *  reset target. The width the pane shipped with in its non-canvas placement
 *  (`28rem`), which is a comfortable column of chat prose. */
export const PANE_WIDTH_PX = 448;

/** The chat's floor: the composer's own minimum. Below this the textarea's
 *  hint row (`@ terminals · / commands · ⇧⏎ newline · paste or drop a file`)
 *  wraps and a tool card's `label · title · time` line stops being one line. */
export const PANE_MIN_WIDTH_PX = 320;

/** The peek's floor: about twenty columns of terminal plus the viewport
 *  header's gutters. Twenty columns is where a wrapped shell prompt still
 *  tells you what the agent is doing — under that the peek is decoration, and
 *  a person dragging the chat wide would rather have the pixels. */
export const PEEK_MIN_WIDTH_PX = 240;

/** The ceiling the STORED number may hold. Not a design bound — the real one
 *  is the row the pane is drawn in, which this module deliberately does not
 *  measure — but the width of the widest display anybody runs kolu on. A
 *  stored number past it is corruption, not a preference, and clamping is a
 *  kinder answer than discarding the user's width. */
export const PANE_MAX_WIDTH_PX = 7680;

/** Clamp a candidate width into the bounds the PERSISTED value may hold. The
 *  stored-value parse and `setOrchestratorPaneWidth` both route through it, so
 *  a hand-edited `localStorage` value cannot escape the range the grip
 *  enforces. */
export function clampStoredPaneWidth(px: number): number {
  return Math.min(PANE_MAX_WIDTH_PX, Math.max(PANE_MIN_WIDTH_PX, px));
}

/** Clamp a width a DRAG is reaching for, inside a row where the chat and the
 *  peek share `availablePx` between them.
 *
 *  This is where "the chat may take most of the window" is actually decided:
 *  the ceiling is whatever is left once the peek keeps its twenty columns, so
 *  on a 1600px row the chat can reach 1360 rather than the old 760. The
 *  `Math.max` matters on a row too narrow to honour both minima — the chat's
 *  floor wins there, because a composer you cannot type in is worse than a
 *  peek you cannot read. */
export function clampDraggedPaneWidth(px: number, availablePx: number): number {
  const ceiling = Math.max(PANE_MIN_WIDTH_PX, availablePx - PEEK_MIN_WIDTH_PX);
  return Math.min(ceiling, Math.max(PANE_MIN_WIDTH_PX, px));
}

/** The stored value's parse, exported for the same reason `readWithFallback`
 *  is: the validation contract is worth a test and the test should not need a
 *  `Storage`. */
export function parsePaneWidth(raw: string): number {
  const n: unknown = JSON.parse(raw);
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`invalid orchestrator pane width: ${raw}`);
  }
  return clampStoredPaneWidth(n);
}

/** Per-device chat width in pixels. The serializer writes a canonical
 *  `JSON.stringify(number)` (e.g. `"448"`), so the parse mirrors it with
 *  `JSON.parse` and accepts ONLY a finite JSON number — a hand-edited `""`,
 *  `"abc"` or `"28rem"` all throw rather than slipping through as a coerced
 *  `Number(...)` would. Two distinct degradations, both surfaced: a non-number
 *  falls back to `PANE_WIDTH_PX` via `onInvalid`; a finite but out-of-range
 *  number CLAMPS to the nearest bound. */
const [orchestratorPaneWidth, setPaneWidthRaw] = persistedPref<number>({
  name: "kolu-orchestrator-pane-width",
  fallback: PANE_WIDTH_PX,
  parse: parsePaneWidth,
  onInvalid: (err, raw) =>
    console.warn(
      `[orchestratorPaneWidth] ignoring invalid stored width ${JSON.stringify(raw)} — falling back to ${PANE_WIDTH_PX}`,
      err,
    ),
});

export { orchestratorPaneWidth };

/** Set the chat width, clamped into bounds. The grip commits this ONCE per
 *  gesture (in `onEnd`, off a local unpersisted drag signal — `makePersisted`
 *  has no debounce, so writing per `pointermove` would hit `localStorage`
 *  60-120×/s), plus once for the double-click reset. The equality guard matters
 *  for both: a no-motion drag commits the unchanged start width, and a
 *  double-click at the default is a no-op. */
export function setOrchestratorPaneWidth(px: number): void {
  const next = clampStoredPaneWidth(px);
  if (next === orchestratorPaneWidth()) return;
  setPaneWidthRaw(next);
}
