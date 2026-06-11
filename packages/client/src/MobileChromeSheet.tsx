/** MobileChromeSheet — content of the pull-down chrome drawer for mobile.
 *
 *  On mobile, the viewport is too tight for a persistent chrome bar, so
 *  global controls live behind a pull-handle at the top of the
 *  terminal. Tap or pull the handle to reveal this sheet. Contents:
 *  identity (logo + connection dot) and the control cluster (command
 *  palette, settings, inspector toggle).
 *
 *  Terminal navigation moved out of this sheet to its own left-edge
 *  swipe drawer — see `MobileDockDrawer`. The split mirrors the
 *  desktop: the dock owns the live-terminal navigator, the
 *  chrome bar owns global controls.
 *
 *  Sheet machinery (open state, drag-to-dismiss, overlay, portal) is
 *  owned by `MobileTileView` via `@corvu/drawer`. This component only
 *  renders the sheet's contents; `onClose` is called after a user
 *  action so the parent can close the drawer. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, createSignal, Show } from "solid-js";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { InspectorToggleIcon, SettingsIcon } from "./ui/Icons";
import Kbd from "./ui/Kbd";
import { clientStale, StaleBadge } from "./ui/StaleBadge";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const MobileChromeSheet: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  /** Close the drawer after the user takes an action (palette open,
   *  inspector toggle). The drawer is otherwise dismissed by drag-down
   *  or overlay tap, both handled by Corvu. */
  onClose: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const pwa = useSurfaceApp();
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

      {/* Client out of sync with the server — the actionable mobile form of the
       *  desktop rail's `≠ srv` signal: a one-tap reload onto the freshly-deployed
       *  build (surface-app's `reload()` — see its `reloadForUpdate` for how it
       *  reaches a no-store shell past a poisoned cache). */}
      <Show when={clientStale()}>
        <button
          type="button"
          data-testid="mobile-stale-reload"
          class="mx-3 mt-2 flex h-9 items-center justify-center gap-2 rounded-lg border border-warning/40 bg-warning/10 text-sm text-warning active:bg-warning/20"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            pwa.reload();
            props.onClose();
          }}
        >
          <StaleBadge />
          <span>Client out of date — reload</span>
        </button>
      </Show>

      {/* Control cluster — palette, settings, inspector. Each button
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
          data-testid="inspector-toggle"
          class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
          classList={{
            "bg-surface-3 text-fg": rightPanel.drawerOpen(),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            // Mobile drawer is session-local — do NOT call togglePanel,
            // which writes the desktop chrome preference. This is the
            // whole reason `drawerOpen` exists as a separate signal.
            rightPanel.setDrawerOpen(!rightPanel.drawerOpen());
            props.onClose();
          }}
          aria-label="Toggle right panel"
        >
          <InspectorToggleIcon active={rightPanel.drawerOpen()} />
        </button>
      </div>
    </div>
  );
};

export default MobileChromeSheet;
