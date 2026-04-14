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

/** Click the visible terminal to restore focus after a dialog closes.
 *  If a terminal already has focus (e.g. sub-panel managed its own focus),
 *  skip the click to avoid stealing focus from the sub-terminal.
 */
export function refocusTerminal() {
  if (document.activeElement?.closest("[data-terminal-id]")) return;
  document
    .querySelector<HTMLElement>("[data-visible][data-terminal-id]")
    ?.click();
}

const ModalDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, the backdrop is transparent so content behind is fully visible (e.g. theme preview). */
  transparentOverlay?: boolean;
  /** Element to receive focus when the dialog opens (passed to Corvu's focus trap). */
  initialFocusEl?: HTMLElement;
  /** Disable Corvu's built-in focus trapping (for custom keyboard navigation). */
  trapFocus?: boolean;
  children: JSX.Element;
}> = (props) => (
  <Dialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    restoreFocus={false}
    onFinalFocus={(e) => e.preventDefault()}
    // terminal.focus() calls (visibility effects, click handlers) emit focusin
    // events that solid-dismissible interprets as the user leaving the dialog.
    closeOnOutsideFocus={false}
    initialFocusEl={props.initialFocusEl}
    trapFocus={props.trapFocus}
  >
    <Dialog.Portal forceMount>
      <Dialog.Overlay
        forceMount
        class="fixed inset-0 z-50 data-[closed]:hidden transition-colors"
        classList={{
          "bg-black/50": !props.transparentOverlay,
          "bg-transparent": !!props.transparentOverlay,
        }}
      />
      <div
        class="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh] pointer-events-none"
        classList={{ hidden: !props.open }}
      >
        <div class="pointer-events-auto">{props.children}</div>
      </div>
    </Dialog.Portal>
  </Dialog>
);

export default ModalDialog;
