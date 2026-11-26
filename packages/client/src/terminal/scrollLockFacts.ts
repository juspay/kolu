/**
 * The two scroll-lock facts the scroll-to-bottom button shows, derived ONCE
 * per change instead of once per reader.
 *
 * WHY A MEMO AND NOT TWO INLINE READS. The button's props sit in the same JSX
 * effect as the rest of the pane, so that effect reads both the terminal
 * handle — which moves when the pane's own store does — and the scroll lock's
 * reactive mirrors, which the WRITE DOOR moves from inside the effect phase
 * (output arriving while the user reads scrollback buffers a chunk, and
 * `hasNewOutput` flips). One store write therefore ran that effect twice: once
 * in its own flush showing the stale lock state, and again after the door's
 * write landed — Solid's `EFFECT_RELAY_TEAR`.
 *
 * Interposing this memo cuts both halves. `equals` compares the two booleans,
 * so a store write that leaves the lock alone notifies nobody, and the door's
 * write reaches the button in the one flush it lands in. The button renders
 * exactly the states it rendered before, one frame earlier in the torn case.
 */

import type { Accessor } from "solid-js";
import { createMemo } from "solid-js";

export interface ScrollLockFacts {
  /** The lock is engaged — the user is holding a position in scrollback. */
  locked: boolean;
  /** Output has arrived that the user has not seen (held behind the lock). */
  newOutput: boolean;
}

/** Source of the facts: the live terminal handle, or null before attach. */
export interface ScrollLockFactsSource {
  scrollLock: {
    isLocked: () => boolean;
    hasNewOutput: () => boolean;
  };
}

export function createScrollLockFacts(
  handle: Accessor<ScrollLockFactsSource | null | undefined>,
): Accessor<ScrollLockFacts> {
  return createMemo(
    () => {
      const h = handle();
      return {
        locked: h?.scrollLock.isLocked() ?? false,
        newOutput: h?.scrollLock.hasNewOutput() ?? false,
      };
    },
    {
      name: "scrollLockFacts",
      equals: (a, b) => a.locked === b.locked && a.newOutput === b.newOutput,
    },
  );
}
