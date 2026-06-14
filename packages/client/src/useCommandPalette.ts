/** Command-palette controller — singleton. Owns the open-state and the
 *  initial-group selection, plus the close policy: on close it resets the group
 *  and refocuses the terminal UNLESS a command opened another dialog (e.g.
 *  "About") — checked reactively via `useDialogStack`, replacing the old
 *  `document.querySelector("[data-corvu-dialog-content]…")` DOM probe. This is
 *  the one overlay with real internal logic, so it earns its own controller;
 *  the trivial toggles use `createDisclosure` instead. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { refocusTerminal } from "./ui/ModalDialog";
import { useDialogStack } from "./ui/useDialogStack";

export const useCommandPalette = createSharedRoot(() => {
  const dialogStack = useDialogStack();
  const [open, setOpen] = createSignal(false);
  const [initialGroup, setInitialGroup] = createSignal<string | undefined>();

  return {
    open,
    initialGroup,
    /** Open the palette at the top level. */
    openPalette() {
      setInitialGroup(undefined);
      setOpen(true);
    },
    /** Open the palette pre-drilled into a named group. */
    openGroup(group: string) {
      setInitialGroup(group);
      setOpen(true);
    },
    /** Flip the palette — the `Cmd+K` chord. */
    toggle: () => setOpen((v) => !v),
    onOpenChange(next: boolean) {
      setOpen(next);
      if (!next) {
        setInitialGroup(undefined);
        // Refocus the terminal only if no OTHER dialog took over: a palette
        // command can open About / Welcome / Diagnostic while closing the
        // palette, and stealing focus back would yank it from the dialog that
        // just opened. The count is read in a rAF so the closing palette has
        // decremented and any opened dialog has incremented — the reactive
        // equivalent of the old `:not([data-closed])` DOM probe.
        requestAnimationFrame(() => {
          if (dialogStack.openCount() === 0) refocusTerminal();
        });
      }
    },
  } as const;
});
