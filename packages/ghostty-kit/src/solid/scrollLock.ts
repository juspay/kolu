/** Scroll-lock latch — freeze incoming writes while the user is reading history.
 *  Copied in spirit from `@kolu/xterm-kit` but not bound to an xterm instance. */

import { createSignal } from "solid-js";

export type ScrollIntentSource =
  | "wheel"
  | "touch"
  | "keyboard"
  | "search"
  | "pointer";

export interface ScrollLockEvent {
  at: number;
  kind: "locked" | "suppressed" | "unlatched";
  source: ScrollIntentSource | null;
  baseY: number;
  viewportY: number;
}

export const SCROLL_INTENT_WINDOW_MS = 500;

export function createScrollLock() {
  const [locked, setLocked] = createSignal(false);
  const [pendingCount, setPendingCount] = createSignal(0);
  let pending: string[] = [];
  let intentUntil = 0;
  let intentHeld = false;
  let lastSource: ScrollIntentSource | null = null;
  const events: ScrollLockEvent[] = [];

  function setPending(next: string[]): void {
    pending = next;
    setPendingCount(next.length);
  }

  function record(
    kind: ScrollLockEvent["kind"],
    baseY: number,
    viewportY: number,
  ): void {
    events.push({
      at: Date.now(),
      kind,
      source: kind === "locked" ? lastSource : null,
      baseY,
      viewportY,
    });
    if (events.length > 20) events.shift();
  }

  return {
    isLocked: () => locked(),
    pending: () => pending,
    events: () => events.slice(),
    armUserScrollIntent(source: ScrollIntentSource): void {
      lastSource = source;
      intentUntil = Date.now() + SCROLL_INTENT_WINDOW_MS;
    },
    holdUserScrollIntent(source: ScrollIntentSource, hold: boolean): void {
      lastSource = source;
      intentHeld = hold;
      if (hold) intentUntil = Date.now() + SCROLL_INTENT_WINDOW_MS;
    },
    lock(baseY: number, viewportY: number): void {
      const armed = intentHeld || Date.now() <= intentUntil;
      if (!armed) {
        record("suppressed", baseY, viewportY);
        return;
      }
      if (!locked()) {
        setLocked(true);
        record("locked", baseY, viewportY);
      }
    },
    unlock(): string[] {
      if (!locked()) return [];
      setLocked(false);
      const flushed = pending;
      setPending([]);
      record("unlatched", 0, 0);
      return flushed;
    },
    buffer(data: string): void {
      setPending([...pending, data]);
    },
    clearPending(): void {
      setPending([]);
    },
    reset(mode: "drop" | "flush" = "drop"): string[] {
      setLocked(false);
      if (mode === "drop") {
        setPending([]);
        return [];
      }
      const flushed = pending;
      setPending([]);
      return flushed;
    },
    pendingChunks: () => pendingCount(),
    lastEvent: () => events[events.length - 1],
    hasNewOutput: () => pendingCount() > 0,
    handleTabVisible: () => {
      if (locked()) {
        setLocked(false);
        setPending([]);
      }
    },
    scrollToBottom: (_term?: unknown) => {
      setLocked(false);
      const flushed = pending;
      setPending([]);
      return flushed;
    },
  };
}

export type ScrollLock = ReturnType<typeof createScrollLock>;
