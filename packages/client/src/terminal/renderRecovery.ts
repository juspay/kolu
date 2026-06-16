/** Render-stall recovery — force a synchronous repaint when xterm's
 *  requestAnimationFrame-driven paint loop has stalled, and expose the
 *  render-pipeline state the Diagnostic Info dialog needs to prove it.
 *
 *  WHY THIS EXISTS (the freeze PRs #1235 and #1273 did NOT fix):
 *
 *  xterm's RenderService schedules every visible paint through ONE
 *  `window.requestAnimationFrame`, with no timer fallback. RenderDebouncer does
 *  `if (this._animationFrame) { return; }` and clears that handle ONLY inside
 *  the rAF callback (`_innerRefresh`). So when Chromium stops producing frames —
 *  a window OCCLUDED by another, e.g. you alt-tab away while an agent fleet runs
 *  (note: macOS/Linux app-switch keeps `document.visibilityState === 'visible'`,
 *  so this is NOT the `document.hidden` path `refitOnTabVisible` watches) — a
 *  pending rAF is never serviced. PTY output keeps arriving and parsing into the
 *  buffer (WriteBuffer's `setTimeout` is merely clamped under occlusion, not
 *  frozen), so every later write only widens the dirty range and hits the
 *  early-return: the screen stays on a stale frame. An input event (a keypress)
 *  forces a `BeginMainFrame` that finally services the parked rAF — which is why
 *  "press any key and it jumps to the latest" was the only known recovery.
 *
 *  Proven deterministically against the pinned @xterm/xterm beta: holding rAF
 *  while writing leaves `buffer.length` growing with ZERO `onRender` firings,
 *  and `_renderService.refreshRows(0, rows - 1, true)` (sync flag bypasses the
 *  debouncer) repaints to the LATEST without a serviced frame.
 *
 *  The fix forces that synchronous repaint on the signals that actually fire
 *  when the user returns to an occluded window. This module is the DOM-free
 *  core (so the node-env unit suite can drive it via injected `now`/`hasFocus`
 *  seams, the same shape `scrollLock` uses): it owns the watchdog and the
 *  forced paint. The one DOM signal — `window`'s `focus` event, which is what
 *  fires on app-switch return (NOT `visibilitychange`) — is wired in
 *  Terminal.tsx, the DOM-adjacent owner, calling `recover()`. Both triggers are
 *  cause-agnostic: they don't depend on WHY frames stopped and don't wait for
 *  the browser to produce one.
 *
 *  This module owns render-stall RECOVERY (the watchdog and the forced sync
 *  paint); the knowledge of xterm's private `_core` shape it depends on
 *  (`_renderService`, DEC private modes) lives in `xtermInternals.ts`, the one
 *  null-guarded home for every `_core.*` reach. So a future beta that renames
 *  those fields degrades to a no-op forceRepaint + "unknown" probes instead of
 *  crashing — and is fixed in exactly one place.
 */

import type { Terminal as XTerm } from "@xterm/xterm";
import { onCleanup } from "solid-js";
import { readDecPrivateMode, renderService } from "./xtermInternals";

/** How long after output arrives we allow a paint to be missing before the
 *  watchdog forces one. Comfortably longer than a serviced rAF (~16 ms) and
 *  xterm's wheel smooth-scroll (~125 ms) so it never fights normal rendering;
 *  short enough that a focused-but-parked recovery is imperceptible. */
export const WATCHDOG_DELAY_MS = 250;

/** DISPLAY warn threshold: how long a paint may lag before the Diagnostic
 *  dialog reddens it for a human reading the dump. Deliberately distinct from
 *  and larger than WATCHDOG_DELAY_MS — they answer different questions. The
 *  watchdog's 250 ms ARMS auto-recovery (short enough to be imperceptible);
 *  this 1000 ms only WARNS a person, who needs a slower, surer signal so a
 *  single late frame doesn't flash red. */
export const PAINT_STALL_WARN_MS = 1000;

/** Whether the document currently has focus. A small testable seam (the unit
 *  suite runs in a node environment with no `document`), mirroring
 *  `scrollLock`'s `visibility` injection. */
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

  // null = "hasn't happened yet" — a real timestamp can legitimately be 0
  // (e.g. a paint on the first tick under fake timers), so 0 can't double as
  // the sentinel.
  let lastDataAt: number | null = null;
  let lastPaintAt: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const onRender = term.onRender(() => {
    lastPaintAt = now();
    // A normal rAF paint caught up — drop any watchdog armed by an earlier
    // chunk. Without this, a timer armed at t≈0 survives the healthy paint at
    // t≈16ms; a chunk landing at t≈240ms (which finds watchdog !== null, so
    // does NOT re-arm) then lets that stale t=250ms timer see paintIsBehind()
    // and force a pointless sync repaint while the render loop is fine. We only
    // ever want a watchdog covering data the latest paint hasn't reached yet.
    if (!paintIsBehind()) disarm();
  });

  function forceRepaint(): void {
    const rs = renderService(term);
    // sync=true routes through RenderService._renderRows synchronously,
    // bypassing the (possibly parked) RenderDebouncer rAF entirely.
    rs?.refreshRows?.(0, Math.max(0, term.rows - 1), true);
  }

  function disarm(): void {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  // The one staleness judgment both recovery paths reason about: is the
  // painted frame behind the data xterm holds? Never painted (null), or the
  // last paint predates the last data we received. During normal focused
  // output the serviced rAF keeps lastPaintAt current, so this is false.
  function paintIsBehind(): boolean {
    return (
      lastPaintAt === null || (lastDataAt !== null && lastDataAt > lastPaintAt)
    );
  }

  function maybeForce(): void {
    watchdog = null;
    if (isOnScreen() && hasFocus() && paintIsBehind()) forceRepaint();
  }

  function noteData(): void {
    lastDataAt = now();
    // Arm once per quiet beat. While occluded the document has no focus, so we
    // don't bother (nobody's looking, and the timer would be clamped anyway) —
    // the window 'focus' handler covers the return. While focused, this catches
    // the rarer parked-while-focused case.
    if (watchdog === null && hasFocus()) {
      watchdog = setTimeout(maybeForce, WATCHDOG_DELAY_MS);
    }
  }

  function recover(): void {
    // Forces unconditionally (does NOT consult paintIsBehind): focus-return is
    // cheap and after an occlusion gap our own staleness bookkeeping can't be
    // trusted.
    if (isOnScreen()) forceRepaint();
  }

  onCleanup(() => {
    disarm();
    onRender.dispose();
  });

  return {
    noteData,
    recover,
    probes: {
      msSinceLastPaint: () =>
        lastPaintAt === null ? null : now() - lastPaintAt,
      renderDebouncerPending: () => {
        const rd = renderService(term)?._renderDebouncer;
        // Absent `_animationFrame` KEY (a future beta renamed it) is "unknown"
        // (null), not "no frame pending" (false) — the probe exists to flag a
        // shape change, so it must not report a renamed field as healthy.
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
