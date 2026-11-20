import { type Accessor, createSignal } from "solid-js";

export interface Disclosure {
  /** Is the dialog open? */
  open: Accessor<boolean>;
  /** Open the dialog. */
  openDialog: () => void;
  /** Flip the dialog. */
  toggle: () => void;
  /** Close the dialog. */
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
