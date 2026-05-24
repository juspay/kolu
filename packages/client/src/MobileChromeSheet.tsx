/** MobileChromeSheet — content of the pull-down chrome drawer for mobile.
 *
 *  On mobile, the viewport is too tight for a persistent chrome bar, so
 *  global controls live behind a pull-handle at the top of the
 *  terminal. Tap or pull the handle to reveal this sheet. Contents:
 *  identity (logo + connection dot) and the control cluster (command
 *  palette, settings, file browser trigger).
 *
 *  Terminal navigation moved out of this sheet to its own left-edge
 *  swipe drawer — see `MobileDockDrawer`. The split mirrors the
 *  desktop: the dock owns the live-terminal navigator, the
 *  chrome bar owns global controls. The Files button opens the
 *  bottom-modal `MobileCodeSheet`; the right panel is hidden on mobile,
 *  so a desktop-style inspector toggle has nothing to act on.
 *
 *  Sheet machinery (open state, drag-to-dismiss, overlay, portal) is
 *  owned by `MobileTileView` via `@corvu/drawer`. This component only
 *  renders the sheet's contents; `onClose` is called after a user
 *  action so the parent can close the drawer. */

import { type Component, createSignal } from "solid-js";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { FileBrowseIcon, SettingsIcon } from "./ui/Icons";
import Kbd from "./ui/Kbd";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const MobileChromeSheet: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  /** Open the mobile file-browser drawer. Owned by `MobileTileView`. */
  onOpenFiles: () => void;
  /** Close the drawer after the user takes an action (palette open,
   *  files open). The drawer is otherwise dismissed by drag-down or
   *  overlay tap, both handled by Corvu. */
  onClose: () => void;
}> = (props) => {
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <div data-testid="mobile-chrome-sheet" class="flex flex-col">
      {/* Drag-grip — visual cue that the whole sheet is draggable.
       *  Corvu wires the drag gesture on Drawer.Content itself, so this
       *  is purely cosmetic. */}
      <div class="flex justify-center pt-2 pb-1" aria-hidden="true">
        <span class="w-10 h-1 rounded-full bg-fg-3/40" />
      </div>

      {/* Header row: identity + connection */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge/50">
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm flex-1">{props.appTitle}</span>
        <span
          data-ws-status={props.status}
          class={`inline-block w-2 h-2 rounded-full ${statusStyles[props.status]}`}
          role="status"
          aria-label="Connection status"
        />
      </div>

      {/* Control cluster — palette, settings, files. Each button
       *  stops propagation on pointerdown so Corvu Drawer's drag handler
       *  on Drawer.Content can't claim the tap as the start of a drag
       *  (which would suppress the click). */}
      <div class="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          data-testid="palette-trigger"
          class="flex-1 h-9 flex items-center justify-center gap-2 text-sm text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            props.onOpenPalette();
            props.onClose();
          }}
        >
          <Kbd>{formatKeybind(ACTIONS.commandPalette.keybind)}</Kbd>
          <span>Palette</span>
        </button>
        <div>
          <button
            type="button"
            ref={settingsTriggerRef}
            data-testid="settings-trigger"
            class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setSettingsOpen(!settingsOpen())}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            triggerRef={settingsTriggerRef}
          />
        </div>
        <button
          type="button"
          data-testid="mobile-files-trigger"
          class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            // Sequence the two drawer transitions across the chrome
            // drawer's close animation (~200ms). When both `open`
            // signals flip in the same tick, Corvu's chrome-drawer
            // close fires a synthetic outside-pointer event that the
            // freshly-opened files drawer interprets as a dismiss tap
            // — the drawer mounts and immediately tears down again,
            // which is what users on iOS see as "Files button does
            // nothing but pop the keyboard". The 220ms timeout lets
            // the chrome overlay fully unmount before the files
            // drawer mounts its own overlay.
            props.onClose();
            setTimeout(() => props.onOpenFiles(), 220);
          }}
          aria-label="Browse files"
        >
          <FileBrowseIcon class="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default MobileChromeSheet;
