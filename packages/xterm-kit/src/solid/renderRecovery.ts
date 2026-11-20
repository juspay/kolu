import type { Terminal as XTerm } from "@xterm/xterm";
import { onCleanup } from "solid-js";
import { readDecPrivateMode, renderService } from "../internals";

/** How long after output arrives we allow a paint to be missing before the
 *  watchdog forces one. Comfortably longer than a serviced rAF (~16 ms) and
 *  xterm's wheel smooth-scroll (~125 ms) so it never fights normal rendering;
 *  short enough that a focused-but-parked recovery is imperceptible. */
export const WATCHDOG_DELAY_MS = 250;

export const PAINT_STALL_WARN_MS = 1000;

function defaultHasFocus(): boolean {
  return typeof document === "undefined" ? true : document.hasFocus();
}

export interface RenderRecoveryProbes {
  /** ms since the last `onRender` firing — climbs without bound while the
   *  paint loop is stalled even as `bufferBytes` grows. The single clearest
   *  freeze signal. `null` when no paint has happened yet (genuinely unknown,
   *  not a fresh 0 ms paint) — the most severe stall, surfaced as "?" rather
   *  than masquerading as the healthiest value. */
  msSinceLastPaint: () => number | null;
  /** RenderDebouncer is holding an unserviced rAF handle. `true` while frozen,
   *  `false` once a frame (or a forced sync paint) clears it, `null` if the
   *  private path changed. */
  renderDebouncerPending: () => boolean | null;
  /** RenderService paused itself (its IntersectionObserver saw the element
   *  leave the layout). Distinguishes an element-not-visible pause from a
   *  whole-window occlusion freeze. */
  isPaused: () => boolean | null;
  /** Terminal is mid synchronized-output (DEC 2026) — a stuck `true` would
   *  withhold paints on its own; rules H5 in or out at freeze time. */
  synchronizedOutput: () => boolean | null;
}

export interface RenderRecovery {
  /** Record that PTY output just reached xterm. Arms the watchdog (debounced)
   *  when the document has focus. */
  noteData: () => void;
  /** Force a synchronous repaint now (if on-screen). For the attention-return
   *  signal (window focus, wired in Terminal.tsx) and the tab-visible handler.
   *  No-op if xterm's shape changed. */
  recover: () => void;
  probes: RenderRecoveryProbes;
}

interface PaintWatchdog {
  noteData: () => void;
  notePaint: () => void;
  msSinceLastPaint: () => number | null;
  disarm: () => void;
}

function createPaintWatchdog(
  now: () => number,
  hasFocus: () => boolean,
  onPaintLate: () => void,
): PaintWatchdog {
  let lastDataAt: number | null = null;
  let lastPaintAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isBehind = (): boolean =>
    lastPaintAt === null || (lastDataAt !== null && lastDataAt > lastPaintAt);

  const disarm = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    noteData: () => {
      lastDataAt = now();
      if (timer !== null || !hasFocus()) return;
      timer = setTimeout(() => {
        timer = null;
        if (isBehind()) onPaintLate();
      }, WATCHDOG_DELAY_MS);
    },
    notePaint: () => {
      lastPaintAt = now();
      if (!isBehind()) disarm();
    },
    msSinceLastPaint: () => (lastPaintAt === null ? null : now() - lastPaintAt),
    disarm,
  };
}

/** Wire render-stall recovery for one terminal. MUST be called synchronously
 *  within the terminal's reactive owner (it registers `onCleanup`).
 *
 *  @param isOnScreen — whether this tile is currently on screen (its `visible`
 *    prop). Gated on it so hidden tiles (`display:none`, whose layout is 0×0)
 *    never burn a synchronous draw. In canvas mode every mounted tile is
 *    `visible`, and any of them can be left stale by an occlusion freeze, so we
 *    recover all on-screen tiles — not just the focused one.
 *  @param deps — injectable `now`/`hasFocus` seams for the node-env unit suite;
 *    production uses `Date.now` and the live `document.hasFocus()`.
 */
export function createRenderRecovery(
  term: XTerm,
  isOnScreen: () => boolean,
  deps: { now?: () => number; hasFocus?: () => boolean } = {},
): RenderRecovery {
  const now = deps.now ?? Date.now;
  const hasFocus = deps.hasFocus ?? defaultHasFocus;

  const watchdog = createPaintWatchdog(now, hasFocus, () => {
    if (isOnScreen() && hasFocus()) forceRepaint();
  });
  const onRender = term.onRender(() => watchdog.notePaint());

  function forceRepaint(): void {
    const rs = renderService(term);
    // sync=true routes through RenderService._renderRows synchronously,
    // bypassing the (possibly parked) RenderDebouncer rAF entirely.
    rs?.refreshRows?.(0, Math.max(0, term.rows - 1), true);
  }

  function recover(): void {
    if (isOnScreen()) forceRepaint();
  }

  onCleanup(() => {
    watchdog.disarm();
    onRender.dispose();
  });

  return {
    noteData: watchdog.noteData,
    recover,
    probes: {
      msSinceLastPaint: watchdog.msSinceLastPaint,
      renderDebouncerPending: () => {
        const rd = renderService(term)?._renderDebouncer;
        if (!rd || !("_animationFrame" in rd)) return null;
        return rd._animationFrame !== undefined;
      },
      isPaused: () => {
        const rs = renderService(term);
        if (!rs || typeof rs._isPaused !== "boolean") return null;
        return rs._isPaused;
      },
      synchronizedOutput: () => readDecPrivateMode(term, "synchronizedOutput"),
    },
  };
}
