/**
 * Shared modal dialog — Corvu Dialog with backdrop, centered layout,
 * and auto-refocus of the active terminal on close.
 *
 * Uses forceMount to keep the dialog always in the DOM. This avoids
 * perceptible mount lag when opening (portal + cmdk tree instantiation).
 * Corvu still manages focus trapping, scroll lock, and Escape-to-close
 * based on the open prop — forceMount only affects DOM presence.
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
    <Dialog.Portal forceMount>
      <Dialog.Overlay
        forceMount
        class="fixed inset-0 z-50 bg-black/50 data-[closed]:hidden"
      />
      <div
        class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none"
        classList={{ hidden: !props.open }}
      >
        <div class="pointer-events-auto">{props.children}</div>
      </div>
    </Dialog.Portal>
  </Dialog>
);

export default ModalDialog;
