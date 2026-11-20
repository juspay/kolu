import type { Terminal } from "@xterm/xterm";
import { resizeTerminal } from "../internals";
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

const EVENT_RING_CAP = 20;

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
  const [lockState, setLockState] = createSignal<{
    source: ScrollIntentSource;
    hiddenAtEngage: boolean;
  } | null>(null);
  const isLocked = () => lockState() !== null;

  const [pending, setPending] = createSignal<PendingItem[]>([]);
  const pendingChunks = () =>
    pending().reduce((n, item) => (item.kind === "data" ? n + 1 : n), 0);
  const hasNewOutput = () => pendingChunks() > 0;

  let termRef: Terminal | null = null;

  let intentAt = Number.NEGATIVE_INFINITY;
  let intentSource: ScrollIntentSource | null = null;
  let heldSource: ScrollIntentSource | null = null;
  const [eventRing, setEventRing] = createSignal<ScrollLockEvent[]>([]);
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
    setEventRing((ring) => {
      const next = [...ring, event];
      return next.length > EVENT_RING_CAP ? next.slice(-EVENT_RING_CAP) : next;
    });
    if (kind === "suppressed" && event.at - lastWarnAt >= WARN_THROTTLE_MS) {
      lastWarnAt = event.at;
      console.warn(
        "[scroll-lock] suppressed an off-bottom scroll with no user input (#1272) — snapping back to bottom",
        event,
      );
    }
  }

  function flush(): void {
    const buffered = pending();
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

  createEffect(
    on(
      enabled,
      (v) => {
        if (v === false) reset();
      },
      { defer: true },
    ),
  );

  function classify(
    atBottom: boolean,
    locked: boolean,
    source: ScrollIntentSource | null,
  ): "flush-release" | "stay-locked" | "suppress" | "engage" {
    if (atBottom) return "flush-release";
    if (locked) return "stay-locked";
    return source === null ? "suppress" : "engage";
  }

  function flushAndRelease(): void {
    if (isLocked()) flush();
    setLockState(null);
  }

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

  function suppressAndSnap(term: Terminal): void {
    recordEvent("suppressed", null, term);
    scheduleSnapBack(term);
  }

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
      const source = recentIntent();
      switch (classify(atBottom, isLocked(), source)) {
        case "flush-release":
          flushAndRelease();
          return;
        case "stay-locked":
          return;
        case "suppress":
          suppressAndSnap(term);
          return;
        case "engage":
          if (source !== null) engage(source, term);
          return;
      }
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
   *
   * `onParsed` (optional) is xterm's own write callback: it fires only when the
   * chunk has actually reached xterm AND been parsed into the buffer (xterm
   * parses asynchronously off a `setTimeout` — `term.write` returns long before
   * the data is paintable). Render-stall recovery passes its `noteData` here so
   * the watchdog is keyed to "data is in the buffer, paint should follow", not
   * to stream receipt; a snapshot frame passes its backfill re-seed committer.
   * When the lock BUFFERS a chunk it produces no paint yet, so `onParsed` is not
   * invoked now — it is stashed WITH the chunk and fired by `flush()` once the
   * buffered write parses on unlock.
   */
  function writeData(
    term: Terminal,
    data: string,
    onParsed?: () => void,
  ): void {
    if (!isLocked()) {
      term.write(data, onParsed);
      return;
    }
    setPending((buffered) => [...buffered, { kind: "data", data, onParsed }]);
  }

  /**
   * The pty's mirror changed size HERE, between the byte before this call and
   * the byte after it. Resize the terminal at that same point.
   *
   * Unlocked, that point is now. LOCKED, it is wherever the held bytes are:
   * the resize joins the queue instead of jumping it, because applying it now
   * would reflow a screen made of bytes that have not been parsed yet — and
   * the user is reading that screen, which is why the lock is engaged.
   *
   * It takes NO terminal, unlike `writeData` beside it: a queued resize is
   * applied by `flush`, which resizes `termRef`.
   */
  function resizeInOrder(cols: number, rows: number): void {
    const term = termRef;
    if (!term) return;
    if (!isLocked()) {
      resizeTerminal(term, cols, rows);
      return;
    }
    setPending((buffered) => [...buffered, { kind: "resize", cols, rows }]);
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
   * rejoin the bottom.
   *
   * A lock the user made with the tab in front (`hiddenAtEngage === false`)
   * is left alone: scrolling up to read output, glancing at another browser
   * tab, and returning must NOT lose the position or flush buffered output
   * (#1272). Only a background/accidental latch is cleared here.
   */
  function handleTabVisible(): void {
    if (!termRef || !lockState()?.hiddenAtEngage) return;
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
