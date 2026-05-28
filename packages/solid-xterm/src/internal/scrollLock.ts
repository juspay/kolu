/**
 * Reactive scroll-lock state machine for an xterm.js Terminal.
 *
 * When the user scrolls up, incoming PTY data buffers instead of
 * writing through to xterm — this avoids the viewport-jumping bug
 * class entirely (no write-then-restore race, no isRestoring guards,
 * no escape-sequence edge cases that force xterm's auto-scroll).
 * When the user scrolls back to the bottom, buffered data is flushed
 * in one shot.
 *
 * Encapsulated axis: xterm.js's `Terminal.onScroll` event + buffer
 * position math (`buffer.active.baseY` vs `viewportY` for the
 * "at bottom" check). Consumers gate writes through `writeData(term,
 * data)` instead of `term.write(data)` and the lock is transparent.
 *
 * Re-entry safety: `flush()` writes the joined buffer in one xterm
 * call — xterm's own write pipeline processes synchronously so the
 * subsequent `onScroll` from the auto-scroll fires after `flush()`
 * returns and the buffer is already drained. No double-flush.
 *
 * Wire `attachToTerminal(term)` synchronously within a SolidJS
 * reactive scope (component body, `onMount`, or a `runWithOwner`
 * restoring the captured owner). If called outside a reactive scope
 * the `onCleanup` is a silent no-op and `termRef` + the onScroll
 * closure leak the xterm Terminal for the rest of the page lifetime
 * (#591 heap-snapshot evidence — keep this constraint visible to
 * future consumers).
 */

import type { Terminal } from "@xterm/xterm";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/**
 * Reactive scroll-lock primitive for an xterm.js terminal.
 *
 * @param enabled — accessor; when false, scroll-lock is disabled entirely
 *                  (writes pass through, scroll events are ignored, and
 *                  the lock resets on the transition from true → false).
 */
export function createScrollLock(enabled: Accessor<boolean | undefined>) {
  const [isLocked, setIsLocked] = createSignal(false);
  const [hasNewOutput, setHasNewOutput] = createSignal(false);

  /** Data buffered while scroll-locked — flushed on unlock. */
  const pendingData: string[] = [];

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
