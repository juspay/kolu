/** Command-palette controller — singleton. Owns the open-state and the
 *  initial-group selection. On close it resets the group; the close-refocus
 *  policy (refocus the terminal unless a command opened another dialog) lives
 *  in `ModalDialog` — the palette routes through it via `refocusOnClose` like
 *  every other dialog, so it doesn't hand-roll the refocus guard. This is the
 *  one overlay with real internal logic (the group reset), so it earns its own
 *  controller; the trivial toggles use `createDisclosure` instead. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";

export const useCommandPalette = createSharedRoot(() => {
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
      // Palette-specific reset only; the close-refocus is `ModalDialog`'s job
      // (CommandPalette passes `refocusOnClose`).
      if (!next) setInitialGroup(undefined);
    },
  } as const;
});
