/** A minimal open/close disclosure — the shared shape behind every trivial
 *  dialog toggle (About, Welcome, Shortcuts help, Diagnostic info). Each is one
 *  `createSignal(false)` plus the open / toggle / onOpenChange triplet the
 *  root-mounted dialog binds to. Deduplicates that shape ONCE instead of
 *  minting a near-empty bespoke hook per dialog.
 *
 *  Instantiate as a module-level singleton co-located with the dialog it drives
 *  (`export const aboutDialog = createDisclosure()`), so the dialog component
 *  owns its open-state and App.tsx only mounts it. Refocus-on-close is NOT this
 *  factory's job — it lives once in `ModalDialog`'s `refocusOnClose`. */

import { type Accessor, createSignal } from "solid-js";

export interface Disclosure {
  /** Is the dialog open? */
  open: Accessor<boolean>;
  /** Open the dialog (the palette / command path). */
  openDialog: () => void;
  /** Flip the dialog (the keyboard-chord path). */
  toggle: () => void;
  /** Close the dialog (the named intent behind `onOpenChange(false)`). */
  close: () => void;
  /** Bind to the dialog's `onOpenChange`. */
  onOpenChange: (open: boolean) => void;
}

export function createDisclosure(): Disclosure {
  const [open, setOpen] = createSignal(false);
  return {
    open,
    openDialog: () => setOpen(true),
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
    onOpenChange: setOpen,
  };
}
