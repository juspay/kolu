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
 *     call sites report via `armUserScrollIntent`.
 *   - An off-bottom scroll with NO recent intent is suppressed: the viewport
 *     snaps back to the bottom and output keeps flowing.
 *   - Returning to the tab releases an engaged lock (`handleTabVisible`),
 *     mirroring the existing "switching back to a terminal auto-scrolls to
 *     bottom" semantics — a lock left behind while the tab was hidden must
 *     not present as a frozen terminal.
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
 *  observed it (Terminal.tsx wheel/key/touch wiring, SearchBar navigation). */
export type ScrollIntentSource = "wheel" | "touch" | "keyboard" | "search";

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

/**
 * Reactive scroll-lock primitive for an xterm.js terminal.
 *
 * @param enabled — accessor; when false, scroll-lock is disabled entirely
 */
export function createScrollLock(enabled: Accessor<boolean | undefined>) {
  const [isLocked, setIsLocked] = createSignal(false);
  const [hasNewOutput, setHasNewOutput] = createSignal(false);
  const [pendingChunks, setPendingChunks] = createSignal(0);
  const [lastEvent, setLastEvent] = createSignal<ScrollLockEvent | null>(null);

  /** Data buffered while scroll-locked — flushed on unlock. */
  const pendingData: string[] = [];

  /** Terminal reference, set on attach. */
  let termRef: Terminal | null = null;

  let intentAt = Number.NEGATIVE_INFINITY;
  let intentSource: ScrollIntentSource | null = null;
  const eventRing: ScrollLockEvent[] = [];
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  /** Report a scroll input the user just made. Call BEFORE the input
   *  reaches xterm (capture-phase listener / pre-`scrollLines` call) — the
   *  resulting `onScroll` fires synchronously and must see the intent. */
  function armUserScrollIntent(source: ScrollIntentSource): void {
    intentAt = Date.now();
    intentSource = source;
  }

  function recentIntent(): ScrollIntentSource | null {
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
      visibility:
        typeof document === "undefined" ? "unknown" : document.visibilityState,
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
    if (pendingData.length === 0 || !termRef) return;
    const data = pendingData.join("");
    pendingData.length = 0;
    setPendingChunks(0);
    termRef.write(data);
  }

  /** Clear all scroll-lock state, flushing any buffered data first. */
  function reset() {
    flush();
    setIsLocked(false);
    setHasNewOutput(false);
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
      setIsLocked(true);
    });
    onCleanup(() => {
      scrollDisposable.dispose();
      termRef = null;
      pendingData.length = 0;
      setPendingChunks(0);
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
    pendingData.push(data);
    setPendingChunks(pendingData.length);
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
  }

  /**
   * The tab just became visible again. A lock that was engaged while the
   * user was away must not greet them as a frozen terminal — flush and
   * rejoin the bottom, the same semantics the existing visible-transition
   * effect applies when switching back to a terminal.
   */
  function handleTabVisible(): void {
    if (!isLocked() || !termRef) return;
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
    handleTabVisible,
    reset,
    attachToTerminal,
    writeData,
    scrollToBottom,
  };
}
