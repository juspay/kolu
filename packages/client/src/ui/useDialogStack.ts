/** Counts how many modal dialogs are currently open — every dialog routes
 *  through `ModalDialog`, which increments on open and decrements on close. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

export const useDialogStack = createSharedRoot(() => {
  const [count, setCount] = createSignal(0);
  return {
    /** How many modal dialogs are currently open. */
    openCount: count,
    /** Called by `ModalDialog` when it opens. */
    increment: () => setCount((n) => n + 1),
    /** Called by `ModalDialog` when it closes. */
    decrement: () => setCount((n) => Math.max(0, n - 1)),
  } as const;
});
