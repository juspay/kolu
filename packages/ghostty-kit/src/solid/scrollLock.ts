/** Scroll-lock latch — freeze incoming writes while the user is reading history.
 *  Copied in spirit from `@kolu/xterm-kit` but not bound to an xterm instance. */

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
  let locked = false;
  let pending: string[] = [];
  let intentUntil = 0;
  let intentHeld = false;
  let lastSource: ScrollIntentSource | null = null;
  const events: ScrollLockEvent[] = [];

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
    isLocked: () => locked,
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
      if (!locked) {
        locked = true;
        record("locked", baseY, viewportY);
      }
    },
    unlock(): string[] {
      if (!locked) return [];
      locked = false;
      const flushed = pending;
      pending = [];
      record("unlatched", 0, 0);
      return flushed;
    },
    buffer(data: string): void {
      pending.push(data);
    },
    clearPending(): void {
      pending = [];
    },
    reset(mode: "drop" | "flush" = "drop"): string[] {
      locked = false;
      if (mode === "drop") {
        pending = [];
        return [];
      }
      const flushed = pending;
      pending = [];
      return flushed;
    },
    pendingChunks: () => pending.length,
    lastEvent: () => events[events.length - 1],
    hasNewOutput: () => pending.length > 0,
    handleTabVisible: () => {
      if (locked) {
        locked = false;
        pending = [];
      }
    },
    scrollToBottom: (_term?: unknown) => {
      locked = false;
      const flushed = pending;
      pending = [];
      return flushed;
    },
  };
}

export type ScrollLock = ReturnType<typeof createScrollLock>;
