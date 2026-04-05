/** Confirmation dialog shown when closing a terminal that has sub-terminal splits.
 *  Informs the user that N sub-terminals will also be closed. */

import type { Component } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";

const SubTerminalCloseConfirm: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subCount: number;
  onConfirm: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      initialFocusEl={cancelRef}
    >
      <Dialog.Content
        class="bg-surface-1 border border-edge-bright rounded-lg p-5 max-w-sm text-sm space-y-4"
        data-testid="split-close-confirm"
      >
        <Dialog.Label class="font-semibold text-fg">
          Close terminal with splits?
        </Dialog.Label>

        <p class="text-fg-2">
          This will also close{" "}
          <span class="font-medium text-fg">
            {props.subCount} sub-terminal{props.subCount > 1 ? "s" : ""}
          </span>
          .
        </p>

        <div class="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            class="px-3 py-1.5 text-xs rounded text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            data-testid="split-close-confirm-yes"
            class="px-3 py-1.5 text-xs rounded bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Close all
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default SubTerminalCloseConfirm;
