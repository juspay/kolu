/** One-shot "the pane has a real grid" latch.
 *
 *  Must be an effect, not a synchronous `if (grid()) fn()`. The consumer
 *  (`Terminal.tsx`) registers this from `onReady` and then finishes declaring
 *  bindings the callback closes over. A sync fire is a TDZ crash. */

import { createEffect, createMemo, on, type Accessor } from "solid-js";
import type { TerminalGrid } from "./grid.ts";

export function createOnceMeasured(
  grid: Accessor<TerminalGrid | null>,
): (fn: (measured: TerminalGrid) => void) => void {
  return (fn) => {
    const first = createMemo<TerminalGrid | null>((prev) => prev ?? grid());
    createEffect(
      on(first, (measured) => {
        if (measured) fn(measured);
      }),
    );
  };
}
