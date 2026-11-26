/** Command-palette controller — singleton. Owns the open state and the
 *  initial drill path. On close it runs the close-refocus policy (refocus the
 *  terminal unless a command opened another dialog). Unlike the trivial
 *  `createDisclosure` dialogs — whose only close paths are Corvu-driven
 *  (Escape / outside click) and so are covered by `ModalDialog`'s
 *  `refocusOnClose` — the palette closes itself programmatically
 *  too: a selected command/workspace row calls `onOpenChange(false)` directly
 *  and the `Cmd+K` chord calls `toggle()`, neither of which re-enters
 *  `ModalDialog.handleOpenChange`. So the palette can't lean on `refocusOnClose`
 *  for those paths. Instead every close path converges on `onOpenChange(false)`
 *  here, which is the ONE home for the palette's refocus; the
 *  ModalDialog mount deliberately omits `refocusOnClose` to avoid a double-fire
 *  on the Corvu path (which also funnels through this `onOpenChange`). This is
 *  the one overlay with real internal logic (self-driven close), so it earns
 *  its own controller; the trivial toggles use `createDisclosure`. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { refocusIfNoDialogOpen } from "./ui/ModalDialog";

// HOST-SCOPING: host-INDEPENDENT by design — pure UI chrome (open flag + path
// of group names); the palette overlay is identical regardless of active host.
// Callers that want a host-scoped deep-link pass the host *label* as a path
// segment (e.g. `openPath(["Terminals", hostLabel(active)])`).
export const useCommandPalette = createSharedRoot(() => {
  const [open, setOpen] = createSignal(false);
  /** Group names to auto-drill on open — e.g. `["Terminals"]` or
   *  `["Terminals", "zest"]` for a host-scoped terminal list. */
  const [initialPath, setInitialPath] = createSignal<readonly string[]>([]);

  /** Close bookkeeping shared by every close path (Corvu dismiss, selection,
   *  toggle): run the guarded terminal refocus.
   *
   *  It does NOT reset `initialPath`. FIVE functions here set `open` to true,
   *  and the four a caller reaches for — `openDialog`, `openPath`,
   *  `openGroup`, `toggle` — set the path before they do, so a close-time
   *  reset changes no answer for them, and it is one more write on the edge
   *  corvu's dismiss effect and the palette's own derivations read, i.e. a
   *  relay of the close for a value nothing reads until the next open.
   *
   *  The fifth is `onOpenChange(true)`, which writes no path — and for this
   *  mount it is unreachable as an open. `App.tsx` hands `onOpenChange` to the
   *  dialog and `ModalDialog` forwards whatever corvu emits; corvu emits
   *  `true` from a `Dialog.Trigger` or from an uncontrolled `initialOpen`, and
   *  the palette mounts neither — its `open` is the prop this controller owns.
   *  So corvu only ever emits `false` here, a dismiss. A trigger added to that
   *  mount would change it, and would want `openDialog()`. */
  function close() {
    setOpen(false);
    refocusIfNoDialogOpen();
  }

  return {
    open,
    initialPath,
    /** Open the palette at the top level. Named `openDialog` to match the
     *  shared overlay-opener verb (`createDisclosure.openDialog`) every
     *  root-mounted dialog answers; `openPath` / `openGroup` are the
     *  palette-only drill-ins. */
    openDialog() {
      setInitialPath([]);
      setOpen(true);
    },
    /** Open the palette pre-drilled along a path of group names. */
    openPath(path: readonly string[]) {
      setInitialPath(path);
      setOpen(true);
    },
    /** Open the palette pre-drilled into a single named group. */
    openGroup(group: string) {
      setInitialPath([group]);
      setOpen(true);
    },
    /** Flip the palette — the `Cmd+K` chord. Routes the close half through the
     *  shared `close()` so a toggle-close clears the stale path and refocuses
     *  the terminal, same as every other close path. */
    toggle() {
      if (open()) close();
      else {
        setInitialPath([]);
        setOpen(true);
      }
    },
    onOpenChange(next: boolean) {
      if (next) setOpen(true);
      else close();
    },
  } as const;
});
