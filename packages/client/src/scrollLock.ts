/**
 * Scroll-lock state machine — owns viewport freeze/restore logic.
 *
 * When the user scrolls up, incoming data is buffered (not written to xterm).
 * This eliminates viewport-jumping bugs entirely — no write-then-restore race,
 * no timing issues with isRestoring guards, no edge cases with escape sequences
 * that force xterm to auto-scroll. When the user scrolls back to the bottom,
 * buffered data is flushed in one shot.
 */

import {
  type Accessor,
  createSignal,
  createEffect,
  on,
  onCleanup,
} from "solid-js";
import type { Terminal } from "@xterm/xterm";

/**
 * Reactive scroll-lock primitive for an xterm.js terminal.
 *
 * @param enabled — accessor; when false, scroll-lock is disabled entirely
 */
export function createScrollLock(enabled: Accessor<boolean | undefined>) {
  const [isLocked, setIsLocked] = createSignal(false);
  const [hasNewOutput, setHasNewOutput] = createSignal(false);

  /** Data buffered while scroll-locked — flushed on unlock. */
  let pendingData: string[] = [];

  /** Terminal reference, set on attach. */
  let termRef: Terminal | null = null;

  /** Flush all buffered data to the terminal. */
  function flush(): void {
    if (pendingData.length === 0 || !termRef) return;
    const data = pendingData.join("");
    pendingData.length = 0;
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
      if (atBottom && isLocked()) {
        // User scrolled back to bottom — flush buffered data
        flush();
      }
      setIsLocked(!atBottom);
      if (atBottom) setHasNewOutput(false);
    });
    onCleanup(() => {
      scrollDisposable.dispose();
      termRef = null;
      pendingData.length = 0;
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

  return {
    isLocked,
    hasNewOutput,
    reset,
    attachToTerminal,
    writeData,
    scrollToBottom,
  };
}
