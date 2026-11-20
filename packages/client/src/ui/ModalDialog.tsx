/** Shared modal dialog — Corvu Dialog with backdrop and centered layout.
 *  `forceMount` keeps it in the DOM (Corvu still manages focus trapping,
 *  scroll lock and Escape-to-close off `open`). */

import Dialog from "@corvu/dialog";
import { type Component, createEffect, type JSX, onCleanup } from "solid-js";
import {
  getActiveTerminalNode,
  getFirstTerminalNode,
} from "../canvas/activeTerminal";
import { isTouch } from "../useMobile";
import { withKeyboardDismiss } from "./dismissSoftKeyboard";
import { useDialogStack } from "./useDialogStack";

/** Click the visible terminal to restore focus after a dialog closes. */
export function refocusTerminal() {
  if (isTouch()) return;
  if (document.activeElement?.closest("[data-terminal-id]")) return;
  (getActiveTerminalNode() ?? getFirstTerminalNode())?.click();
}

/** Refocus the terminal after a dialog closes, unless another dialog took
 *  over. Deferred a frame so the open-count has settled. */
export function refocusIfNoDialogOpen() {
  const dialogStack = useDialogStack();
  requestAnimationFrame(() => {
    if (dialogStack.openCount() === 0) refocusTerminal();
  });
}

/** Width cap for the flex-item wrapper that holds the dialog body: `w-full` on
 *  a content-auto flex item collapses to min-content, so the cap must sit on
 *  the wrapper, never on the body itself. */
const WIDTH_WRAPPER_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  palette: "max-w-[min(90vw,44rem)]",
  lg: "max-w-[min(95vw,80rem)]",
} as const;

const ModalDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, the backdrop is transparent so content behind is fully visible (e.g. theme preview). */
  transparentOverlay?: boolean;
  /** Element to receive focus when the dialog opens (passed to Corvu's focus trap). */
  initialFocusEl?: HTMLElement;
  /** Disable Corvu's built-in focus trapping (for custom keyboard navigation). */
  trapFocus?: boolean;
  /** Refocus the active terminal when the dialog closes. Off by default. */
  refocusOnClose?: boolean;
  /** Max width cap. Defaults to "md". */
  size?: "sm" | "md" | "palette" | "lg";
  children: JSX.Element;
}> = (props) => {
  const dialogStack = useDialogStack();
  createEffect(() => {
    if (props.open) {
      dialogStack.increment();
      onCleanup(() => dialogStack.decrement());
    }
  });

  const handleOpenChange = (open: boolean) => {
    props.onOpenChange(open);
    if (props.refocusOnClose && !open) refocusIfNoDialogOpen();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={withKeyboardDismiss(handleOpenChange)}
      restoreFocus={false}
      onFinalFocus={(e) => e.preventDefault()}
      // Terminal focus() calls emit focusin, which solid-dismissible otherwise
      // reads as the user leaving the dialog.
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
          <div
            class={`pointer-events-auto w-full ${WIDTH_WRAPPER_CLASS[props.size ?? "md"]}`}
          >
            {props.children}
          </div>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
};

export default ModalDialog;
