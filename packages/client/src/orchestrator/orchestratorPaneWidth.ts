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
 *  `Preferences` schema rung. The rendered width is capped in CSS rather than
 *  here (`max-width`), so a window that shrinks under a stored-wide pane leaves
 *  the peek visible and the grip reachable without this module measuring
 *  anything. */

import { persistedPref } from "../persistedPref";

/** Default chat width — where a fresh install lands, and the double-click
 *  reset target. The width the pane shipped with in its non-canvas placement
 *  (`28rem`), which is a comfortable column of chat prose. */
export const PANE_WIDTH_PX = 448;

// Bounds for the user-resizable chat. The floor keeps a tool card's
// `label · title · time` line and a fleet row legible; the ceiling keeps the
// conversation from swallowing the terminal it is about. The default sits
// inside the range.
const PANE_MIN_WIDTH_PX = 320;
const PANE_MAX_WIDTH_PX = 760;

/** Clamp a candidate width into the resize bounds. The drag setter and the
 *  stored-value parse both route through it, so a hand-edited `localStorage`
 *  value cannot escape the range the grip enforces. */
export function clampOrchestratorPaneWidth(px: number): number {
  return Math.min(PANE_MAX_WIDTH_PX, Math.max(PANE_MIN_WIDTH_PX, px));
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
  parse: (raw) => {
    const n: unknown = JSON.parse(raw);
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`invalid orchestrator pane width: ${raw}`);
    }
    return clampOrchestratorPaneWidth(n);
  },
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
  const next = clampOrchestratorPaneWidth(px);
  if (next === orchestratorPaneWidth()) return;
  setPaneWidthRaw(next);
}
