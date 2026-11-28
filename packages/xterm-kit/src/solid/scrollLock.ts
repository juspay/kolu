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
  onCleanup,
  untrack,
} from "solid-js";
import { resizeTerminal } from "../internals";

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

/** One thing the lock is holding back, in stream order.
 *
 *  `data` is bytes to write (with the callback that fires when they parse);
 *  `resize` is the grid the pty's mirror moved to at that point between two
 *  bytes. They share one queue because what the resize MEANS is its position
 *  relative to the bytes around it — applied early, it reflows a screen the
 *  held bytes were never written for. */
export type PendingItem =
  | { kind: "data"; data: string; onParsed?: () => void }
  | { kind: "resize"; cols: number; rows: number };

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
  /** Single source of truth for the lock and its origin. Non-null means
   *  locked; `hiddenAtEngage` carries whether the lock was created while the
   *  document was hidden (the signature `handleTabVisible` clears). Clearing
   *  the lock is one assignment (`setLockState(null)`) that necessarily drops
   *  the hidden-origin with it — no parallel flag to reset in lockstep.
   *
   *  THE AUTHORITY IS THE PLAIN VARIABLE. Solid 2 holds a signal write until
   *  the queue flushes, and every decision in here is made SYNCHRONOUSLY
   *  inside one event dispatch: a scroll that engages the lock is followed, in
   *  the same turn, by the write door asking whether to buffer. Read off a
   *  signal that answer would still be "unlocked" and the bytes the lock was
   *  just engaged to hold would jump the user's screen — the exact defect this
   *  module exists to prevent. The signal beside it is the REACTIVE MIRROR the
   *  UI re-runs on; one writer moves both. TRACKED
   *  readers (`isLocked`, `pending`) subscribe to the mirror and answer from
   *  the authority, so a tracked read is never a flush behind an imperative
   *  one. IMPERATIVE readers (`lockedNow`, `pendingNow`) answer from the
   *  authority ALONE: the write door and the flush path reach them from inside
   *  the effect phase, where subscribing is both meaningless — nothing re-runs
   *  them — and a dev diagnostic. */
  let lock: {
    source: ScrollIntentSource;
    hiddenAtEngage: boolean;
  } | null = null;
  const [lockMirror, setLockMirror] = createSignal<{
    source: ScrollIntentSource;
    hiddenAtEngage: boolean;
  } | null>(null);
  const setLockState = (
    next: { source: ScrollIntentSource; hiddenAtEngage: boolean } | null,
  ): void => {
    lock = next;
    setLockMirror(next);
  };
  const lockNow = (): {
    source: ScrollIntentSource;
    hiddenAtEngage: boolean;
  } | null => {
    lockMirror();
    return lock;
  };
  const isLocked = () => lockNow() !== null;
  /** The lock, answered WITHOUT subscribing — for the imperative paths (the
   *  write door, the flush/release path) that are not waiting to be re-run by
   *  a later value. They run inside the effect phase, where a tracked read is
   *  a dev diagnostic (STRICT_READ_UNTRACKED) as well as a pointless
   *  subscription. Same answer as `isLocked()` by construction: both report
   *  the plain authority, and only the mirror subscription differs. */
  const lockedNow = (): boolean => lock !== null;

  /** What the lock is holding back, IN ORDER — flushed on unlock.
   *
   *  Two kinds of item, because two kinds of thing travel the write door and
   *  the ORDER between them is load-bearing. A `data` entry keeps its own
   *  `onParsed` write callback: a chunk's callback fires only when its bytes
   *  reach xterm's buffer, and a snapshot frame's backfill re-seed rides one
   *  (Terminal.tsx). A `resize` entry is the pty telling us its mirror changed
   *  size at that exact point in the byte stream — held here so it cannot
   *  overtake bytes the user's scroll-up is keeping unparsed, which would
   *  reflow a screen those bytes were not written for.
   *
   *  Authority + mirror for the same reason the lock has them: a drain empties
   *  the buffer and a write that follows in the same turn must see it empty,
   *  or the held bytes would be written twice. `pendingChunks` counts the DATA
   *  items only — it means "output you have not seen", and a resize is not
   *  output. */
  let heldItems: PendingItem[] = [];
  const [pendingMirror, setPendingMirror] = createSignal<PendingItem[]>([]);
  const setPending = (next: PendingItem[]): void => {
    heldItems = next;
    setPendingMirror(next);
  };
  const pending = (): PendingItem[] => {
    pendingMirror();
    return heldItems;
  };
  /** The buffer, answered WITHOUT subscribing — the imperative counterpart of
   *  `pending()`, for the same reason `lockedNow` exists beside `isLocked`. */
  const pendingNow = (): PendingItem[] => heldItems;
  const pendingChunks = () =>
    pending().reduce((n, item) => (item.kind === "data" ? n + 1 : n), 0);
  const hasNewOutput = () => pendingChunks() > 0;

  /** Terminal reference, set on attach. */
  let termRef: Terminal | null = null;

  let intentAt = Number.NEGATIVE_INFINITY;
  let intentSource: ScrollIntentSource | null = null;
  /** While a pointer (or other discrete gesture) is held, intent stays armed
   *  regardless of the time window — selection auto-scroll and scrollbar
   *  dragging emit `onScroll` ticks for as long as the button is down, well
   *  past `SCROLL_INTENT_WINDOW_MS` after the initial press. */
  let heldSource: ScrollIntentSource | null = null;
  /** Source of truth for the transition history. `lastEvent` (live row) and
   *  `events()` (JSON dump) are both derived from it — one ring, two read
   *  patterns, no hand-synced head signal. Authority + mirror like the lock
   *  above: a transition recorded inside a scroll dispatch is read back in the
   *  same turn (the diagnostics row, and the tests that pin the transition),
   *  which a deferred signal write would answer with the previous event. */
  let ring: ScrollLockEvent[] = [];
  const [ringMirror, setRingMirror] = createSignal<ScrollLockEvent[]>([]);
  const eventRing = (): ScrollLockEvent[] => {
    ringMirror();
    return ring;
  };
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  /** Report a scroll input the user just made. Call BEFORE the input
   *  reaches xterm (capture-phase listener / pre-`scrollLines` call) — the
   *  resulting `onScroll` fires synchronously and must see the intent. */
  function armUserScrollIntent(source: ScrollIntentSource): void {
    intentAt = Date.now();
    intentSource = source;
  }

  /** Keep intent armed for as long as a pointer is held, for gestures that
   *  scroll repeatedly while the button is down (scrollbar drag, selection
   *  auto-scroll). The time window doesn't fit those — the press is one event
   *  but the scroll ticks keep coming.
   *
   *  Deliberately does NOT also arm the time window: those gestures emit their
   *  `onScroll` ticks *during* the hold (xterm scrolls on `pointermove` /
   *  the selection interval, both bounded by `pointerup`), never after release,
   *  so `heldSource` alone covers them. Arming the window here too would leave
   *  a 500 ms "pointer" tail after every press — including a plain click, which
   *  scrolls nothing — and a spurious scroll landing in that tail would latch
   *  the very freeze this gating exists to prevent (#1272). */
  function holdUserScrollIntent(source: ScrollIntentSource): void {
    heldSource = source;
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
    const next = [...ring, event];
    ring = next.length > EVENT_RING_CAP ? next.slice(-EVENT_RING_CAP) : next;
    setRingMirror(ring);
    if (kind === "suppressed" && event.at - lastWarnAt >= WARN_THROTTLE_MS) {
      lastWarnAt = event.at;
      console.warn(
        "[scroll-lock] suppressed an off-bottom scroll with no user input (#1272) — snapping back to bottom",
        event,
      );
    }
  }

  /** Replay everything the lock is holding, IN ORDER.
   *
   *  Consecutive data items are joined and written in ONE shot — that is the
   *  whole reason the buffer exists — but a held resize CUTS the run: the bytes
   *  before it are written, then the terminal is resized, then the run after it
   *  starts. `resizeTerminal` flush-parses the queued write at the OLD grid
   *  before reflowing, so the cut needs no await and no scheduling: the bytes
   *  land at the width they were written for and the next run lands at the new
   *  one. Collapsing the resizes to "apply them all at the end" would be the
   *  original defect in miniature — a screen reflowed under bytes laid out for
   *  a size it no longer has.
   *
   *  Each run's `onParsed` callbacks fire once that run has PARSED — so a
   *  backfill re-seed (or render-stall `noteData`) that rode a chunk's callback
   *  still runs after the flush lands, instead of being dropped. A
   *  callback-less flush is what silently lost a snapshot frame's seed under
   *  scroll lock, leaving a stale backfill cursor against the reset buffer. */
  function drain(buffered: readonly PendingItem[]): void {
    const term = termRef;
    if (buffered.length === 0 || !term) return;
    setPending([]);
    let run: string[] = [];
    let callbacks: (() => void)[] = [];
    const writeRun = (): void => {
      if (run.length === 0 && callbacks.length === 0) return;
      const data = run.join("");
      const cbs = callbacks;
      run = [];
      callbacks = [];
      // A run of callback-only entries (an empty chunk carrying a seed) has
      // nothing to parse, so its callbacks fire now rather than never.
      if (data.length === 0) {
        for (const cb of cbs) cb();
        return;
      }
      term.write(
        data,
        cbs.length === 0
          ? undefined
          : () => {
              for (const cb of cbs) cb();
            },
      );
    };
    for (const item of buffered) {
      if (item.kind === "data") {
        run.push(item.data);
        if (item.onParsed) callbacks.push(item.onParsed);
        continue;
      }
      writeRun();
      resizeTerminal(term, item.cols, item.rows);
    }
    writeRun();
  }

  /** The imperative façade over {@link drain}: reads the buffer's current
   *  contents and replays them. Every caller is an event handler, a write-door
   *  entry or the public API — never a tracked reader, hence `pendingNow`; the
   *  `enabled` effect below drains the same way, from its apply arm. */
  function flush(): void {
    drain(pendingNow());
  }

  /** Drop everything the lock is holding, bytes and resizes alike, without
   *  applying any of it (snapshot / re-attach reset). */
  function dropPending(): void {
    setPending([]);
  }

  /** Clear all scroll-lock state. Default flushes buffered data first; pass
   *  `"drop"` to discard pending bytes without writing (fresh-snapshot path). */
  function reset(pending: "flush" | "drop" = "flush") {
    if (pending === "flush") flush();
    else dropPending();
    setLockState(null);
  }

  // Clear scroll lock when the setting is toggled off. The compute reads ONLY
  // the setting: the buffer is whatever the door has accumulated by the time
  // this runs, so the apply arm takes it from the plain authority. Riding it
  // on the compute instead subscribed this effect to every chunk the door
  // buffers — a write that lands in the effect phase, so one root write ran
  // this effect twice (EFFECT_RELAY_TEAR) for a dependency it never needed.
  createEffect(
    () => enabled() === false,
    (off) => {
      if (!off) return;
      drain(pendingNow());
      setLockState(null);
    },
    { defer: true, name: "scrollLockDisabled" },
  );

  /** Pure verdict for an off-/at-bottom scroll — the latch decision in
   *  isolation, readable without the xterm re-entrancy workaround, the
   *  instrumentation, or the visibility capture in scope:
   *   - `flush-release` — back at the bottom; drop the lock and flush.
   *   - `stay-locked`    — already locked, moving through scrollback.
   *   - `suppress`       — off-bottom with no user input behind it (#1272).
   *   - `engage`         — off-bottom on a real user scroll; latch.
   */
  function classify(
    atBottom: boolean,
    locked: boolean,
    source: ScrollIntentSource | null,
  ): "flush-release" | "stay-locked" | "suppress" | "engage" {
    if (atBottom) return "flush-release";
    if (locked) return "stay-locked";
    return source === null ? "suppress" : "engage";
  }

  /** Back at the bottom (user scrolled down, or our own snap-back re-entered
   *  here) — flush anything held and release.
   *
   *  A scroll that was never locked releases NOTHING, and returning early is not
   *  a micro-optimisation: xterm fires this from inside whoever moved the
   *  viewport — `terminal.reset()` in a consumer's effect among them — and a
   *  write to reactive state from an owned scope is a dev diagnostic
   *  (REACTIVE_WRITE_IN_OWNED_SCOPE). Re-stating `null` over `null` would raise
   *  it for a scroll that changed nothing. Nothing is held while unlocked (the
   *  write door only buffers under a lock), so there is nothing to flush either. */
  function flushAndRelease(): void {
    if (!lockedNow()) return;
    flush();
    setLockState(null);
  }

  /** Latch the lock on a real user scroll, capturing whether it engaged while
   *  the tab was hidden (the signature `handleTabVisible` clears). */
  function engage(source: ScrollIntentSource, term: Terminal): void {
    recordEvent("locked", source, term);
    setLockState({ source, hiddenAtEngage: visibility() === "hidden" });
  }

  /** The deferred-snap re-entrancy workaround in one home: the snap-back is
   *  deferred OUT of xterm's scroll dispatch, because the Viewport guards
   *  against re-entrant scrolls and a synchronous scrollToBottom() here is
   *  silently dropped (observed against the shipped @xterm/xterm
   *  6.1.0-beta.225). A microtask later the dispatch has unwound. The guard
   *  re-checks state at drain time: skip if `term` is no longer the attached
   *  terminal (onCleanup ran in between) or a real user scroll latched the
   *  lock since — never yank an engaged lock. */
  function scheduleSnapBack(term: Terminal): void {
    queueMicrotask(() => {
      if (termRef === term && !isLocked()) term.scrollToBottom();
    });
  }

  /** Off-bottom with no user input behind it — not the user's scroll. Snap
   *  back and keep output flowing instead of freezing the terminal (#1272).
   *  Owns the forensic record and the suppression warn-throttle (via
   *  recordEvent); defers the snap itself to `scheduleSnapBack`. */
  function suppressAndSnap(term: Terminal): void {
    recordEvent("suppressed", null, term);
    scheduleSnapBack(term);
  }

  /** Wire the onScroll handler and self-register cleanup on the caller's
   *  reactive owner. Must be called synchronously within a reactive scope
   *  (e.g. within a `runWithOwner` restoring the
   *  component's owner after an await) — otherwise `onCleanup` silently
   *  no-ops and the `onScroll` closure + `termRef` leak the xterm Terminal
   *  across the component's lifetime (#591 heap-snapshot evidence).
   *
   *  The handler body runs UNTRACKED, and that is about DEPENDENCIES, not
   *  about quieting anything. xterm fires its scroll event from inside other
   *  people's calls — `terminal.reset()` among them — and the handler reads
   *  the lock's own state (`enabled()`, `lockNow()`). An effect CALLBACK is
   *  already untracked in Solid 2, so the case this still covers is a TRACKING
   *  scope entering xterm's dispatch: a memo or a render effect's compute that
   *  resets/resizes the terminal would otherwise subscribe to the lock and
   *  re-run every time it engages. The reads themselves are an event
   *  callback's imperative snapshot — nothing here is waiting to be re-run by
   *  a later value — which is why they belong in the handler rather than being
   *  hoisted into some compute. */
  function attachToTerminal(term: Terminal): void {
    termRef = term;
    const scrollDisposable = term.onScroll(() => untrack(() => onScroll(term)));
    onCleanup(() => {
      scrollDisposable.dispose();
      termRef = null;
      setPending([]);
    });
  }

  /** One xterm scroll event, classified against the lock. */
  function onScroll(term: Terminal): void {
    if (enabled() === false) return;
    const buf = term.buffer.active;
    const atBottom = buf.baseY <= buf.viewportY;
    const source = recentIntent();
    switch (classify(atBottom, isLocked(), source)) {
      case "flush-release":
        flushAndRelease();
        return;
      case "stay-locked":
        // The user is moving through scrollback — no new transition to
        // record, the lock simply stays engaged.
        return;
      case "suppress":
        suppressAndSnap(term);
        return;
      case "engage":
        // `source` is non-null on this branch by construction of `classify`;
        // the guard narrows it for the type checker without a cast.
        if (source !== null) engage(source, term);
        return;
    }
  }

  /**
   * Scroll-aware write: when locked, buffer data instead of writing to xterm.
   * This completely avoids viewport-jumping — xterm never processes the data
   * until the user is at the bottom and ready to see it.
   *
   * `onParsed` (optional) is xterm's own write callback: it fires only when the
   * chunk has actually reached xterm AND been parsed into the buffer (xterm
   * parses asynchronously off a `setTimeout` — `term.write` returns long before
   * the data is paintable). Render-stall recovery passes its `noteData` here so
   * the watchdog is keyed to "data is in the buffer, paint should follow", not
   * to stream receipt; a snapshot frame passes its backfill re-seed committer.
   * When the lock BUFFERS a chunk it produces no paint yet, so `onParsed` is not
   * invoked now — it is stashed WITH the chunk and fired by `flush()` once the
   * buffered write parses on unlock. (Firing it while buffered would arm the
   * watchdog against unpainted data, forcing pointless sync repaints of the
   * scrollback the user is reading; deferring it to flush both avoids that AND
   * keeps a re-seed that rides the callback from being lost across the lock.)
   */
  function writeData(
    term: Terminal,
    data: string,
    onParsed?: () => void,
  ): void {
    if (!lockedNow()) {
      term.write(data, onParsed);
      return;
    }
    // Stash the callback WITH the chunk (not invoked now — no paint yet); flush()
    // fires it once the buffered write parses on unlock, so a re-seed that rides
    // the callback survives the lock instead of being silently dropped.
    setPending([...pendingNow(), { kind: "data", data, onParsed }]);
  }

  /**
   * The pty's mirror changed size HERE, between the byte before this call and
   * the byte after it. Resize the terminal at that same point.
   *
   * Unlocked, that point is now. LOCKED, it is wherever the held bytes are:
   * the resize joins the queue instead of jumping it, because applying it now
   * would reflow a screen made of bytes that have not been parsed yet — and
   * the user is reading that screen, which is why the lock is engaged. This is
   * the hazard the old `applyFit` named and declined to fix ("a resize
   * overtaking bytes held by scroll lock"); the resize travelling the same
   * door as the bytes is the fix.
   *
   * It takes NO terminal, unlike `writeData` beside it: a queued resize is
   * applied by `flush`, which resizes `termRef`, so a terminal passed in here
   * would be the one resized while unlocked and ignored while locked — two
   * sources for "which terminal" on the one path whose whole point is that
   * nothing gets out of order.
   */
  function resizeInOrder(cols: number, rows: number): void {
    const term = termRef;
    if (!term) return;
    if (!lockedNow()) {
      resizeTerminal(term, cols, rows);
      return;
    }
    setPending([...pendingNow(), { kind: "resize", cols, rows }]);
  }

  /**
   * Flush buffered data and scroll to bottom.
   * Call this from the "scroll to bottom" button handler.
   */
  function scrollToBottom(term: Terminal): void {
    flush();
    term.scrollToBottom();
    setLockState(null);
  }

  /**
   * The tab just became visible again. A lock that *engaged while the tab was
   * hidden* must not greet the returning user as a frozen terminal — flush and
   * rejoin the bottom, the same semantics the existing visible-transition
   * effect applies when switching back to a terminal.
   *
   * A lock the user made with the tab in front (`hiddenAtEngage === false`)
   * is left alone: scrolling up to read output, glancing at another browser
   * tab, and returning must NOT lose the position or flush buffered output
   * (#1272). Only a background/accidental latch is cleared here.
   */
  function handleTabVisible(): void {
    if (!termRef || !lockNow()?.hiddenAtEngage) return;
    recordEvent("unlatched", null, termRef);
    scrollToBottom(termRef);
  }

  /** Most recent transition (the live diagnostics row), or null if none yet —
   *  the tail of the one ring. */
  const lastEvent = (): ScrollLockEvent | null => eventRing().at(-1) ?? null;

  /** Forensic trail for the Diagnostic Info JSON dump (newest last). */
  const events = (): ScrollLockEvent[] => eventRing();

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
    dropPending,
    attachToTerminal,
    writeData,
    resizeInOrder,
    scrollToBottom,
  };
}
