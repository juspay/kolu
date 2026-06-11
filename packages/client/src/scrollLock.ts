/**
 * Scroll-lock state machine — owns viewport freeze/restore logic.
 *
 * When the user scrolls up, incoming data is buffered (not written to xterm).
 * This eliminates viewport-jumping bugs entirely — no write-then-restore race,
 * no timing issues with isRestoring guards, no edge cases with escape sequences
 * that force xterm to auto-scroll. When the user scrolls back to the bottom,
 * buffered data is flushed in one shot.
 *
 * The latch is gated on USER INTENT (#1272): xterm fires `onScroll` for more
 * than wheel input — touch-bridge artifacts, alt-buffer exits re-emitting a
 * stale viewport position, smooth-scroll ticks delivered late after a tab was
 * backgrounded. Latching on those froze the terminal indefinitely, because a
 * latched lock stops feeding xterm, which starves xterm's own self-healing
 * (its next-write re-pin of a non-user-scrolled viewport) — and on the desktop
 * canvas nothing else ever resets the lock. So:
 *
 *   - An off-bottom scroll engages the lock only within a short window after
 *     a real scroll input (wheel / touch / scroll keys / search jump), which
 *     call sites report via `armUserScrollIntent`. Pointer-held gestures
 *     (scrollbar drag, selection auto-scroll) scroll for as long as the button
 *     is down, past that window, so they `holdUserScrollIntent` from press to
 *     release instead.
 *   - An off-bottom scroll with NO recent intent is suppressed: the viewport
 *     snaps back to the bottom and output keeps flowing.
 *   - Returning to the tab releases a lock that ENGAGED WHILE THE TAB WAS
 *     HIDDEN (`handleTabVisible`) — a background latch must not present as a
 *     frozen terminal. A lock the user made with the tab in front is preserved:
 *     scrolling up to read, glancing at another browser tab, and coming back
 *     keeps both the position and the buffered output.
 *
 * Every transition is recorded (with a stack) in a small ring so the
 * Diagnostic Info dialog can show what engaged a lock in the wild.
 */

import type { Terminal } from "@xterm/xterm";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/** How long a reported scroll input arms the latch. Long enough to cover
 *  xterm's wheel smooth-scroll animation frames (~125 ms) on a loaded
 *  machine; short enough that a stale scroll event minutes later (the #1272
 *  freeze class) can't pass as the user's. */
export const SCROLL_INTENT_WINDOW_MS = 500;

/** Bounded forensic trail — enough to see a pattern, small enough to dump
 *  into the Diagnostic Info JSON wholesale. */
const EVENT_RING_CAP = 20;

/** Don't let a misbehaving emitter turn the suppression warning into log
 *  spam — one warning per lock instance per interval. */
const WARN_THROTTLE_MS = 5_000;

/** A scroll input the user actually made, as reported by the call site that
 *  observed it (Terminal.tsx wheel/key/touch/pointer wiring, SearchBar
 *  navigation). `pointer` covers scrollbar drag and selection auto-scroll —
 *  both run off a held pointer, so it stays armed until the pointer lifts
 *  rather than expiring on the time window (see `holdUserScrollIntent`). */
export type ScrollIntentSource =
  | "wheel"
  | "touch"
  | "keyboard"
  | "search"
  | "pointer";

/** One scroll-lock transition, with enough context to identify the emitter
 *  after the fact (#1272 instrumentation). */
export interface ScrollLockEvent {
  /** Epoch ms. */
  at: number;
  kind: "locked" | "suppressed" | "unlatched";
  /** Intent source that armed a `locked` event; null for the others. */
  source: ScrollIntentSource | null;
  baseY: number;
  viewportY: number;
  bufferType: "normal" | "alternate";
  visibility: string;
  hasFocus: boolean | null;
  /** Synchronous capture — every known emitter (wheel handler, touch
   *  bridge, buffer switch) is on the stack when `onScroll` fires, so this
   *  names the trigger. */
  stack: string | undefined;
}

/** Current document visibility, as a small testable seam (the unit suite runs
 *  in a Node environment with no `document`). Production reads the real DOM. */
function defaultVisibility(): string {
  return typeof document === "undefined" ? "unknown" : document.visibilityState;
}

/**
 * Reactive scroll-lock primitive for an xterm.js terminal.
 *
 * @param enabled — accessor; when false, scroll-lock is disabled entirely
 * @param visibility — current document visibility ("visible" | "hidden" | …);
 *   injectable for tests, defaults to the live `document.visibilityState`
 */
export function createScrollLock(
  enabled: Accessor<boolean | undefined>,
  visibility: () => string = defaultVisibility,
) {
  const [isLocked, setIsLocked] = createSignal(false);
  const [hasNewOutput, setHasNewOutput] = createSignal(false);
  const [lastEvent, setLastEvent] = createSignal<ScrollLockEvent | null>(null);

  /** Data buffered while scroll-locked — flushed on unlock. The reactive
   *  source for the buffer; `pendingChunks` is derived from its length, so
   *  there is exactly one write surface (`setPending`) and no parallel count
   *  to keep in sync. */
  const [pending, setPending] = createSignal<string[]>([]);
  const pendingChunks = () => pending().length;

  /** Terminal reference, set on attach. */
  let termRef: Terminal | null = null;

  let intentAt = Number.NEGATIVE_INFINITY;
  let intentSource: ScrollIntentSource | null = null;
  /** While a pointer (or other discrete gesture) is held, intent stays armed
   *  regardless of the time window — selection auto-scroll and scrollbar
   *  dragging emit `onScroll` ticks for as long as the button is down, well
   *  past `SCROLL_INTENT_WINDOW_MS` after the initial press. */
  let heldSource: ScrollIntentSource | null = null;
  /** True if the engaged lock was created while the document was hidden — the
   *  signature of a background/accidental latch that `handleTabVisible` should
   *  clear. A lock the user made with the tab in front is left alone. */
  let lockedWhileHidden = false;
  const eventRing: ScrollLockEvent[] = [];
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  /** Report a scroll input the user just made. Call BEFORE the input
   *  reaches xterm (capture-phase listener / pre-`scrollLines` call) — the
   *  resulting `onScroll` fires synchronously and must see the intent. */
  function armUserScrollIntent(source: ScrollIntentSource): void {
    intentAt = Date.now();
    intentSource = source;
  }

  /** Arm intent and keep it armed until `releaseUserScrollIntent`, for
   *  gestures that scroll repeatedly while a pointer is held (scrollbar drag,
   *  selection auto-scroll). The time window doesn't fit those — the press is
   *  one event but the scroll ticks keep coming. */
  function holdUserScrollIntent(source: ScrollIntentSource): void {
    heldSource = source;
    armUserScrollIntent(source);
  }

  function releaseUserScrollIntent(): void {
    heldSource = null;
  }

  function recentIntent(): ScrollIntentSource | null {
    if (heldSource !== null) return heldSource;
    return Date.now() - intentAt <= SCROLL_INTENT_WINDOW_MS
      ? intentSource
      : null;
  }

  function recordEvent(
    kind: ScrollLockEvent["kind"],
    source: ScrollIntentSource | null,
    term: Terminal,
  ): void {
    const buf = term.buffer.active;
    const event: ScrollLockEvent = {
      at: Date.now(),
      kind,
      source,
      baseY: buf.baseY,
      viewportY: buf.viewportY,
      bufferType: buf.type,
      visibility: visibility(),
      hasFocus: typeof document === "undefined" ? null : document.hasFocus(),
      stack: new Error("scroll-lock transition").stack,
    };
    eventRing.push(event);
    if (eventRing.length > EVENT_RING_CAP) eventRing.shift();
    setLastEvent(event);
    if (kind === "suppressed" && event.at - lastWarnAt >= WARN_THROTTLE_MS) {
      lastWarnAt = event.at;
      console.warn(
        "[scroll-lock] suppressed an off-bottom scroll with no user input (#1272) — snapping back to bottom",
        event,
      );
    }
  }

  /** Flush all buffered data to the terminal. */
  function flush(): void {
    const buffered = pending();
    if (buffered.length === 0 || !termRef) return;
    const data = buffered.join("");
    setPending([]);
    termRef.write(data);
  }

  /** Clear all scroll-lock state, flushing any buffered data first. */
  function reset() {
    flush();
    setIsLocked(false);
    setHasNewOutput(false);
    lockedWhileHidden = false;
  }

  // Clear scroll lock when the setting is toggled off
  createEffect(
    on(
      enabled,
      (v) => {
        if (v === false) reset();
      },
      { defer: true },
    ),
  );

  /** Wire the onScroll handler and self-register cleanup on the caller's
   *  reactive owner. Must be called synchronously within a reactive scope
   *  (e.g. inside `onMount`, or within a `runWithOwner` restoring the
   *  component's owner after an await) — otherwise `onCleanup` silently
   *  no-ops and the `onScroll` closure + `termRef` leak the xterm Terminal
   *  across the component's lifetime (#591 heap-snapshot evidence). */
  function attachToTerminal(term: Terminal): void {
    termRef = term;
    const scrollDisposable = term.onScroll(() => {
      if (enabled() === false) return;
      const buf = term.buffer.active;
      const atBottom = buf.baseY <= buf.viewportY;
      if (atBottom) {
        // Back at the bottom (user scrolled down, or our own snap-back
        // below re-entered here) — flush anything held and release.
        if (isLocked()) flush();
        setIsLocked(false);
        setHasNewOutput(false);
        lockedWhileHidden = false;
        return;
      }
      // Already locked: the user is moving through scrollback — no new
      // transition to record, the lock simply stays engaged.
      if (isLocked()) return;
      const source = recentIntent();
      if (source === null) {
        // Off-bottom with no user input behind it — not the user's scroll.
        // Snap back and keep output flowing instead of freezing the
        // terminal (#1272). The snap-back is deferred OUT of xterm's scroll
        // dispatch: the Viewport guards against re-entrant scrolls, so a
        // synchronous scrollToBottom() here is silently dropped (observed
        // against the shipped @xterm/xterm 6.1.0-beta.225). A microtask
        // later the dispatch has unwound. Re-check the lock in case a real
        // user scroll latched in between — never yank an engaged lock.
        recordEvent("suppressed", null, term);
        queueMicrotask(() => {
          if (termRef === term && !isLocked()) term.scrollToBottom();
        });
        return;
      }
      recordEvent("locked", source, term);
      lockedWhileHidden = visibility() === "hidden";
      setIsLocked(true);
    });
    onCleanup(() => {
      scrollDisposable.dispose();
      termRef = null;
      setPending([]);
    });
  }

  /**
   * Scroll-aware write: when locked, buffer data instead of writing to xterm.
   * This completely avoids viewport-jumping — xterm never processes the data
   * until the user is at the bottom and ready to see it.
   */
  function writeData(term: Terminal, data: string): void {
    if (!isLocked()) {
      term.write(data);
      return;
    }
    setHasNewOutput(true);
    setPending((buffered) => [...buffered, data]);
  }

  /**
   * Flush buffered data and scroll to bottom.
   * Call this from the "scroll to bottom" button handler.
   */
  function scrollToBottom(term: Terminal): void {
    flush();
    term.scrollToBottom();
    setIsLocked(false);
    setHasNewOutput(false);
    lockedWhileHidden = false;
  }

  /**
   * The tab just became visible again. A lock that *engaged while the tab was
   * hidden* must not greet the returning user as a frozen terminal — flush and
   * rejoin the bottom, the same semantics the existing visible-transition
   * effect applies when switching back to a terminal.
   *
   * A lock the user made with the tab in front (`lockedWhileHidden === false`)
   * is left alone: scrolling up to read output, glancing at another browser
   * tab, and returning must NOT lose the position or flush buffered output
   * (#1272). Only a background/accidental latch is cleared here.
   */
  function handleTabVisible(): void {
    if (!isLocked() || !termRef || !lockedWhileHidden) return;
    recordEvent("unlatched", null, termRef);
    scrollToBottom(termRef);
  }

  /** Forensic trail for the Diagnostic Info JSON dump (newest last). */
  function events(): ScrollLockEvent[] {
    return [...eventRing];
  }

  return {
    isLocked,
    hasNewOutput,
    pendingChunks,
    lastEvent,
    events,
    armUserScrollIntent,
    holdUserScrollIntent,
    releaseUserScrollIntent,
    handleTabVisible,
    reset,
    attachToTerminal,
    writeData,
    scrollToBottom,
  };
}
