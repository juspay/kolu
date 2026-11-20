import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, Show } from "solid-js";
import MobileHostRow from "./host/MobileHostRow";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { daemonTransportLive, serverDot } from "./kaval/useDaemonStatus";
import { useConductorBadge } from "./conductor/useConductorFacts";
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
  onClose: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const pwa = useSurfaceApp();
  const badge = useConductorBadge();
  let settingsTriggerRef!: HTMLButtonElement;

  return (
    <div data-testid="mobile-chrome-sheet" class="flex flex-col">
      <div class="flex justify-center pt-2 pb-1" aria-hidden="true">
        <span class="w-10 h-1 rounded-full bg-fg-3/40" />
      </div>

      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge/50">
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm flex-1">{props.appTitle}</span>
        <span
          data-ws-status={props.status}
          class={`inline-block w-2 h-2 rounded-full ${serverDot(props.status, daemonTransportLive())}`}
          role="status"
          aria-label="Connection status"
        />
      </div>

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
          <span
            aria-hidden="true"
            classList={{ "text-accent": !conductorMode() }}
          >
            ◆
          </span>
          <span>Conductor</span>
          <span
            data-testid="conductor-alpha"
            class="rounded-sm bg-fg-3/15 px-1 py-px font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-fg-3"
          >
            alpha
          </span>
          <Show when={badge.waiting() > 0}>
            <span
              data-testid="conductor-badge"
              data-asking=""
              data-waiting={badge.waiting()}
              class="ml-auto min-w-5 rounded-full bg-alert px-1.5 text-center text-[0.68rem] font-semibold leading-5 text-surface-0"
            >
              {badge.waiting()}
            </span>
          </Show>
        </button>
      </div>

      <MobileHostRow onSwitch={props.onClose} />

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
