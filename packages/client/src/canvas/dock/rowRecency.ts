/** The dock's recency STRINGS — the one place a row's clock is read.
 *
 *  `@kolu/solid-dockrow` owns which rendering a row gets (`recencyMode`), which
 *  timestamp that rendering means (`displayRecencyAt`), the violet capsule and
 *  the reserved 8ch track. What it deliberately does not own is the CLOCK: a
 *  ticking `now` is ambient app state, and kolu runs two of them on purpose —
 *  a 1 s tick for the wait chip, whose sub-minute seconds must count up, and a
 *  plain `Date.now()` read for "3m ago", which recomputes on mount because the
 *  60 s ceiling on its visual lag is invisible.
 *
 *  So the fold is here, ONCE, for all three row surfaces (`DockRow`,
 *  `DockListRow`, the needs-you strip). Each used to spell `displayRecencyAt(…)`
 *  itself and hand the cell a raw timestamp; now each hands it the same value,
 *  and the wait chip's "no honest reading → the dash" rule — a violet pill with
 *  no glyph reads as a rendering bug, not as "unknown" — is stated once. */

import type { RowRecency } from "@kolu/solid-dockrow";
import { displayRecencyAt, recencyMode } from "@kolu/solid-dockrow/rowValues";
import { DASH } from "kolu-common/surface";
import { formatTimeAgo, useDuration } from "../../terminal/staleness";

/** Build the row-recency reader. Call from a component body: the returned
 *  function reads the shared 1 s clock in the wait-chip arm, so a long-blocked
 *  agent's capsule counts up without a repaint hook, and reads nothing at all
 *  in the other two arms. */
export function useRowRecency(): (
  pip: { asking: boolean; active: boolean },
  /** The tile's window recency — newest activity across parent and splits. */
  windowRecencyAt: number | null,
  /** THIS row's own agent recency — how long it has awaited you. */
  ownRecencyAt: number | null,
) => RowRecency {
  const duration = useDuration();
  return (pip, windowRecencyAt, ownRecencyAt) => {
    const mode = recencyMode(pip);
    const at = displayRecencyAt(mode, windowRecencyAt, ownRecencyAt);
    if (mode === "hidden") return { mode, text: "" };
    if (mode === "ago") return { mode, text: formatTimeAgo(at) };
    // Compact live duration ("2m" → "20h") — compact, not "2m ago": the capsule
    // sits in the 8ch recency track and the suffix would wrap it. A never-active
    // row has no honest duration, and the capsule cannot render empty.
    return { mode, text: at === null ? DASH : duration(at) };
  };
}
