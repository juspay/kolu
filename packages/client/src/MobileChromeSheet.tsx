/** MobileChromeSheet — content of the pull-down chrome drawer for mobile.
 *
 *  On mobile, the viewport is too tight for a persistent chrome bar, so
 *  global controls live behind a pull-handle at the top of the
 *  terminal. Tap or pull the handle to reveal this sheet. Contents:
 *  identity (logo + connection dot) and the control cluster (command
 *  palette, settings, inspector toggle).
 *
 *  Terminal navigation moved out of this sheet to its own left-edge
 *  swipe drawer (the `DockList`, mounted by `MobileTileView`). The split
 *  mirrors the desktop: the dock owns the live-terminal navigator, the
 *  chrome bar owns global controls.
 *
 *  Sheet machinery (open state, drag-to-dismiss, overlay, portal) is
 *  owned by `MobileTileView` via `@corvu/drawer`. This component only
 *  renders the sheet's contents; `onClose` is called after a user
 *  action so the parent can close the drawer. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, Show } from "solid-js";
import MobileHostRow from "./host/MobileHostRow";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { daemonTransportLive, serverDot } from "./kaval/useDaemonStatus";
import { conductorAsksTotal } from "./conductor/useConductorFacts";
import {
  enterConductorMode,
  conductorMode,
} from "./conductor/useConductorMode";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { setSettingsOpen, settingsOpen } from "./settings/useSettingsOpen";
import { InspectorToggleIcon, SettingsIcon } from "./ui/Icons";
import Kbd from "./ui/Kbd";
import { clientStale, StaleBadge } from "./ui/StaleBadge";

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
          // Floored on the watchdog-backed `health().live` (same as the desktop srv
          // dot), so a silent half-open can't paint green over a dead link.
          class={`inline-block w-2 h-2 rounded-full ${serverDot(props.status, daemonTransportLive())}`}
          role="status"
          aria-label="Connection status"
        />
      </div>

      {/* The conductor FIRST, as on the desktop tab row: this sheet is the
       *  phone's tab row, and the conversation is the one place that reaches
       *  every host. It is not a host — no status dot, no hue, nothing in the
       *  host row below. Selecting it shows the chat over the whole screen
       *  under the pull handle, and the handle opens this same sheet from
       *  there, so a host chip below is the way back. EXACTLY ONE place looks
       *  current: while the conversation is on screen this entry is lit and no
       *  host chip is (`useActiveHostSelector`). */}
      <div class="border-b border-edge/50 px-3 py-2">
        <button
          type="button"
          data-testid="conductor-tab"
          data-active={conductorMode() ? "" : undefined}
          aria-current={conductorMode() ? "page" : undefined}
          class="relative flex min-h-[44px] w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          classList={{
            "border-accent/60 bg-accent/12 text-accent": conductorMode(),
            "border-edge bg-surface-2 text-fg-2 active:bg-surface-3":
              !conductorMode(),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            enterConductorMode();
            props.onClose();
          }}
          aria-label={ACTIONS.toggleConductor.label}
        >
          {/* The mark carries the accent at rest here too — one destination,
              one hue, whichever layout you reach it from. */}
          <span
            aria-hidden="true"
            classList={{ "text-accent": !conductorMode() }}
          >
            ◆
          </span>
          <span>Conductor</span>
          {/* Inline, beside the name, for the same reason as the desktop
              tab's: the corner holds the needs-you count, and the tag is a
              constant rather than something that arrives. */}
          <span
            data-testid="conductor-alpha"
            class="rounded-sm bg-fg-3/15 px-1 py-px font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-fg-3"
          >
            alpha
          </span>
          <Show when={conductorAsksTotal() > 0}>
            <span
              data-testid="conductor-badge"
              class="ml-auto min-w-5 rounded-full bg-alert px-1.5 text-center text-[0.68rem] font-semibold leading-5 text-surface-0"
            >
              {conductorAsksTotal()}
            </span>
          </Show>
        </button>
      </div>

      {/* Host row — the mobile face of the keyed padi host map: per-host chips
       *  (tap to switch — from the Conductor too, which a tap leaves), attention
       *  pills, and the in-sheet add-host section. Closes the sheet on a switch
       *  so the canvas is visible immediately. The desktop `HostSelectorStrip`
       *  is `isDesktop()`-gated, so this is the ONLY host chrome the touch
       *  layout has. */}
      <MobileHostRow onSwitch={props.onClose} />

      {/* Client out of sync with the server — the actionable mobile form of the
       *  desktop rail's `≠ srv` signal: a one-tap reload onto the deployed build
       *  (surface-app's `reload()` is a plain location.reload() — kolu has no
       *  caching service worker — landing fresh because the shell is no-store
       *  and carries the build identity; kolu#1319). */}
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
        {/* The inspector is about a host's terminal, so — as on the desktop
         *  bar — it is not offered while the Conductor is the current place. */}
        <Show when={!conductorMode()}>
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
            aria-label={ACTIONS.toggleRightPanel.label}
          >
            <InspectorToggleIcon active={rightPanel.drawerOpen()} />
          </button>
        </Show>
      </div>
    </div>
  );
};

export default MobileChromeSheet;
