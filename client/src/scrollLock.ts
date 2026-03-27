/**
 * Scroll-lock state machine — owns viewport freeze/restore logic.
 *
 * Isolates the temporal coupling (isRestoring guard + queueMicrotask) into
 * a single primitive so Terminal.tsx doesn't need to manage it.
 */

import { type Accessor, createSignal, createEffect, on } from "solid-js";
import type { Terminal } from "@xterm/xterm";

/**
 * Reactive scroll-lock primitive for an xterm.js terminal.
 *
 * @param enabled — accessor; when false, scroll-lock is disabled entirely
 */
export function createScrollLock(enabled: Accessor<boolean | undefined>) {
  const [isLocked, setIsLocked] = createSignal(false);
  const [hasNewOutput, setHasNewOutput] = createSignal(false);

  // Guard flag: true while restoring scroll position after a write, so the
  // onScroll handler ignores our own scrollToLine call.
  let isRestoring = false;

  /** Clear all scroll-lock state in one shot. */
  function reset() {
    setIsLocked(false);
    setHasNewOutput(false);
  }

  // Clear scroll lock when the setting is toggled off
  createEffect(
    on(
      () => enabled(),
      (on) => {
        if (on === false) reset();
      },
      { defer: true },
    ),
  );

  /** Wire the onScroll handler to detect when user scrolls away from bottom. */
  function attachToTerminal(term: Terminal): void {
    term.onScroll(() => {
      if (isRestoring || enabled() === false) return;
      const buf = term.buffer.active;
      const atBottom = buf.baseY <= buf.viewportY;
      setIsLocked(!atBottom);
      if (atBottom) setHasNewOutput(false);
    });
  }

  /**
   * Scroll-aware write: when locked, preserves viewport position.
   *
   * xterm.js normally keeps the viewport in place (adjusting for scrollback
   * trimming). We only intervene if xterm unexpectedly auto-scrolls to bottom.
   */
  function writeData(term: Terminal, data: string): void {
    if (!isLocked()) {
      term.write(data);
      return;
    }
    setHasNewOutput(true);
    const savedY = term.buffer.active.viewportY;
    isRestoring = true;
    term.write(data, () => {
      const buf = term.buffer.active;
      // Only restore if xterm auto-scrolled to the bottom. Normally
      // xterm keeps the viewport in place (adjusted for any trimming)
      // — overriding with a stale savedY would drift the view.
      if (buf.viewportY >= buf.baseY && buf.baseY > 0) {
        term.scrollToLine(Math.min(savedY, buf.baseY - 1));
      }
      queueMicrotask(() => (isRestoring = false));
    });
  }

  return { isLocked, hasNewOutput, reset, attachToTerminal, writeData };
}
