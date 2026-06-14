/** Command-palette controller — singleton. Owns the open-state and the
 *  initial-group selection. On close it resets the group AND runs the
 *  close-refocus policy (refocus the terminal unless a command opened another
 *  dialog). Unlike the trivial `createDisclosure` dialogs — whose only close
 *  paths are Corvu-driven (Escape / outside click) and so are covered by
 *  `ModalDialog`'s `refocusOnClose` — the palette closes itself programmatically
 *  too: a selected command/workspace row calls `onOpenChange(false)` directly
 *  and the `Cmd+K` chord calls `toggle()`, neither of which re-enters
 *  `ModalDialog.handleOpenChange`. So the palette can't lean on `refocusOnClose`
 *  for those paths. Instead every close path converges on `onOpenChange(false)`
 *  here, which is the ONE home for the palette's group-reset + refocus; the
 *  ModalDialog mount deliberately omits `refocusOnClose` to avoid a double-fire
 *  on the Corvu path (which also funnels through this `onOpenChange`). This is
 *  the one overlay with real internal logic (group reset + self-driven close),
 *  so it earns its own controller; the trivial toggles use `createDisclosure`. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { refocusIfNoDialogOpen } from "./ui/ModalDialog";

export const useCommandPalette = createSharedRoot(() => {
  const [open, setOpen] = createSignal(false);
  const [initialGroup, setInitialGroup] = createSignal<string | undefined>();

  /** Close bookkeeping shared by every close path (Corvu dismiss, selection,
   *  toggle): drop the drilled-in group so the next plain open starts at root,
   *  then run the guarded terminal refocus. */
  function close() {
    setOpen(false);
    setInitialGroup(undefined);
    refocusIfNoDialogOpen();
  }

  return {
    open,
    initialGroup,
    /** Open the palette at the top level. Named `openDialog` to match the
     *  shared overlay-opener verb (`createDisclosure.openDialog`) every
     *  root-mounted dialog answers; `openGroup` is the palette-only drill-in. */
    openDialog() {
      setInitialGroup(undefined);
      setOpen(true);
    },
    /** Open the palette pre-drilled into a named group. */
    openGroup(group: string) {
      setInitialGroup(group);
      setOpen(true);
    },
    /** Flip the palette — the `Cmd+K` chord. Routes the close half through the
     *  shared `close()` so a toggle-close clears the stale group and refocuses
     *  the terminal, same as every other close path. */
    toggle() {
      if (open()) close();
      else {
        setInitialGroup(undefined);
        setOpen(true);
      }
    },
    onOpenChange(next: boolean) {
      if (next) setOpen(true);
      else close();
    },
  } as const;
});
