/**
 * Shared modal dialog — Corvu Dialog with backdrop, centered layout,
 * and auto-refocus of the active terminal on close.
 *
 * Uses forceMount to keep the dialog always in the DOM. This avoids
 * perceptible mount lag when opening (portal + cmdk tree instantiation).
 * Corvu still manages focus trapping, scroll lock, and Escape-to-close
 * based on the open prop — forceMount only affects DOM presence.
 */

import Dialog from "@corvu/dialog";
import { type Component, createEffect, type JSX, onCleanup } from "solid-js";
import {
  getActiveTerminalNode,
  getFirstTerminalNode,
} from "../canvas/activeTerminal";
import { isTouch } from "../useMobile";
import { withKeyboardDismiss } from "./dismissSoftKeyboard";
import { useDialogStack } from "./useDialogStack";

/** Click the visible terminal to restore focus after a dialog closes.
 *  If a terminal already has focus (e.g. sub-panel managed its own focus),
 *  skip the click to avoid stealing focus from the sub-terminal.
 */
export function refocusTerminal() {
  // On touch the soft keyboard rises only from an explicit terminal tap;
  // clicking the terminal here to restore "keep typing" focus would summon it
  // with no user intent (the click lands on the container's focus handler →
  // term.focus()). Desktop keeps the convenience.
  if (isTouch()) return;
  if (document.activeElement?.closest("[data-terminal-id]")) return;
  // Prefer the active tile's terminal — clicking the first DOM tile
  // would fire its onFocus and silently flip activeId to whoever
  // happens to be first in tileIds order. The accessor scopes to
  // CanvasTile's data-active convention and won't pick up sub-panel
  // headers / chrome tabs / mode chips that also set data-active in
  // their own format (#845).
  (getActiveTerminalNode() ?? getFirstTerminalNode())?.click();
}

/** Refocus the terminal after a dialog closes — but only if no OTHER dialog
 *  took over. A command can open About / Welcome / Diagnostic while closing the
 *  one it ran from, and stealing focus back would yank it from the dialog that
 *  just opened. Deferred a frame so the closing dialog has decremented and any
 *  opened dialog has incremented — the reactive equivalent of the old
 *  `:not([data-closed])` DOM probe. This is the single home for the
 *  close-refocus policy: every `refocusOnClose` dialog and the command palette
 *  route through it. */
export function refocusIfNoDialogOpen() {
  const dialogStack = useDialogStack();
  requestAnimationFrame(() => {
    if (dialogStack.openCount() === 0) refocusTerminal();
  });
}

// Width cap for the dialog. Applied to the flex-item wrapper (not Dialog.Content)
// so the child's `w-full` resolves against a definite parent width — otherwise
// `w-full` on a content-auto flex item collapses to min-content on desktop.
const SIZE_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  // `lg` is sized to fit the command palette's workspace-grid body:
  // 12rem repo facet + 4 agent-state columns + breathing room. The
  // cap scales with the viewport so a 27" monitor doesn't render a
  // tiny dialog in the middle of all that space, while a 13"
  // laptop still gets the 95vw fallback. 80rem = 1280px caps the
  // upper end on ultrawide displays.
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
  /** Refocus the active terminal when the dialog closes. Off by default — the
   *  command palette runs its own guarded refocus, and CloseConfirm manages
   *  focus itself. The simple dialogs (About, Welcome,
   *  Shortcuts help, Diagnostic info) opt in so the close-refocus policy lives
   *  in one place instead of being hand-duplicated at each call site. */
  refocusOnClose?: boolean;
  /** Max width cap — "sm" (24rem) for confirms/help, "md" (28rem) for
   *  legacy palette callers, "lg" (min(95vw, 80rem)) for the unified
   *  command palette whose workspace-grid body needs the extra room.
   *  Defaults to "md". */
  size?: "sm" | "md" | "lg";
  children: JSX.Element;
}> = (props) => {
  // Every modal goes through this boundary, so reflecting `open` into the
  // shared count here keeps `useDialogStack.openCount()` a complete,
  // self-healing "is any dialog open" signal — no enumeration of per-dialog
  // signals to keep in sync.
  const dialogStack = useDialogStack();
  createEffect(() => {
    if (props.open) {
      dialogStack.increment();
      onCleanup(() => dialogStack.decrement());
    }
  });

  const handleOpenChange = (open: boolean) => {
    props.onOpenChange(open);
    // Mirrors the retired App-side `withRefocus`: refocus after the setter, on
    // close. The guard (only if no other dialog took over) lives once in
    // `refocusIfNoDialogOpen`, shared with the command palette.
    if (props.refocusOnClose && !open) refocusIfNoDialogOpen();
  };

  return (
    <Dialog
      open={props.open}
      // withKeyboardDismiss: on close, blur any dialog-hosted input (palette
      // query, find bar, …) so closing the dialog on touch leaves the soft
      // keyboard down — the same overlay-close policy the mobile drawers carry.
      // restoreFocus={false} + refocusTerminal's touch no-op keep it from coming
      // back. No-op on desktop.
      onOpenChange={withKeyboardDismiss(handleOpenChange)}
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
          <div
            class={`pointer-events-auto w-full ${SIZE_CLASS[props.size ?? "md"]}`}
          >
            {props.children}
          </div>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
};

export default ModalDialog;
