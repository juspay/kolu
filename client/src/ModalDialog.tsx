/**
 * Shared modal dialog — Corvu Dialog with backdrop, centered layout,
 * and auto-refocus of the active terminal on close.
 */

import { type Component, type JSX } from "solid-js";
import Dialog from "@corvu/dialog";

/** Click the visible terminal to restore focus after a dialog closes. */
function refocusTerminal() {
  document
    .querySelector<HTMLElement>("[data-visible][data-terminal-id]")
    ?.click();
}

const ModalDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}> = (props) => (
  <Dialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    restoreFocus={false}
    onFinalFocus={(e) => {
      e.preventDefault();
      refocusTerminal();
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
        <div class="pointer-events-auto">{props.children}</div>
      </div>
    </Dialog.Portal>
  </Dialog>
);

export default ModalDialog;
