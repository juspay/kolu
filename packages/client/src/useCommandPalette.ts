import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { refocusIfNoDialogOpen } from "./ui/ModalDialog";

export const useCommandPalette = createSharedRoot(() => {
  const [open, setOpen] = createSignal(false);
  const [initialPath, setInitialPath] = createSignal<readonly string[]>([]);

  function close() {
    setOpen(false);
    setInitialPath([]);
    refocusIfNoDialogOpen();
  }

  return {
    open,
    initialPath,
    openDialog() {
      setInitialPath([]);
      setOpen(true);
    },
    openPath(path: readonly string[]) {
      setInitialPath(path);
      setOpen(true);
    },
    openGroup(group: string) {
      setInitialPath([group]);
      setOpen(true);
    },
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
