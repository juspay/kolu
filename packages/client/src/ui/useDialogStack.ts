/** Counts how many modal dialogs are currently open. Every dialog routes
 *  through `ModalDialog`, which increments on open and decrements on close, so
 *  this is a complete, self-healing replacement for the old
 *  `document.querySelector("[data-corvu-dialog-content]:not([data-closed])")`
 *  probe: a new dialog that uses `ModalDialog` is counted for free, with no
 *  per-dialog enumeration to keep in sync. Read `openCount()` to ask "is any
 *  dialog open right now" — the command palette's close policy uses it to skip
 *  refocusing the terminal when a command opened another dialog. */

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
