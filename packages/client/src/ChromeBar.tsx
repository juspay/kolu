/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Left → right: quiet Kolu mark, host tab strip (primary multi-host
 *  nav; Padi/Kaval dual marks ride each host tab), global control
 *  cluster (recorder, maximize, dock, inspector, settings, command palette).
 *  The live-terminal navigator lives on the dock at the canvas's left edge
 *  (#903) — not here.
 *
 *  A single DOCKED full-width top bar in BOTH postures (tiled + maximized):
 *  `relative shrink-0` in flex flow, spanning the whole viewport, so the
 *  canvas and the right inspector panel flow BELOW it rather than the bar
 *  overlaying either. There is no panel-width right-offset — the header reads
 *  as one continuous top rail across the workspace. The band is a NEUTRAL chrome
 *  surface (no host/PWA hue tint) — per-host colour lives on the tabs, so the
 *  active tab's own hue stands out instead of blending into a same-hue band.
 *  `posture.mode()` no longer changes the bar's positioning; it only picks the
 *  maximize/restore affordance and the `data-maximized` marker.
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import { type Component, createMemo, Show } from "solid-js";
import { dockExpanded, toggleRailCards } from "./canvas/dock/Dock";
import { useFocusTile } from "./canvas/useFocusTile";
import HostSelectorStrip from "./host/HostSelectorStrip";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { setSettingsOpen, settingsOpen } from "./settings/useSettingsOpen";
import {
  DockToggleIcon,
  InspectorToggleIcon,
  MaximizeIcon,
  RestoreIcon,
  SettingsIcon,
} from "./ui/Icons";
import IdentityRail from "./ui/IdentityRail";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";

// Shared base for the square icon toggles in the control cluster
// (maximize, dock, inspector). Active/idle coloring is layered on via
// each button's own `classList`. Keep ring/size tweaks here so all
// three toggles stay in lockstep.
const toggleBtnClass =
  "pointer-events-auto hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const ChromeBar: Component<{
  status: WsStatus;
  onOpenPalette: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const focusTile = useFocusTile();
  let settingsTriggerRef!: HTMLButtonElement;

  // Whether the camera is currently held on the active tile, and whether
  // focusing is meaningful at all — both read from the one focus verb so the
  // button can never disagree with what a click would do.
  const held = createMemo(() => focusTile.isFocused());
  const canFocus = focusTile.canFocus;
  const focusLabel = createMemo(() =>
    held() ? "Release focus (Esc)" : "Focus tile",
  );

  return (
    <header
      data-testid="chrome-bar"
      data-focused={held() ? "" : undefined}
      // Solid chrome owns this strip's pointer area. Individual controls still
      // carry their own pointer/focus classes, but empty header space should
      // behave like header, not click through to the canvas behind it.
      //
      // DOCKED full-width in BOTH postures (`relative shrink-0`) so the bar
      // spans the whole viewport and the canvas + right inspector flow BELOW
      // it — the tabbed header reads as one continuous top rail. The header is
      // NEUTRAL (no host/PWA hue tint) — colour lives on the tabs — so the
      // active tab's hue stands out instead of blending into a same-hue band.
      // No drop shadow: a shadow under the bar makes the tabs look like they
      // float ABOVE the content, fighting the connected-tab metaphor. `z-50`
      // keeps the workspace-switcher dropdown above the maximized tile (z-40).
      class="chrome-bar-surface relative z-50 flex h-10 shrink-0 items-stretch gap-3 bg-surface-0 px-3 pt-2 pb-0 select-none pointer-events-auto transition-colors duration-150"
    >
      {/* Quiet Kolu mark — connection + dialogs; versions live in the dialog. */}
      <div class="flex h-8 shrink-0 items-center pointer-events-auto">
        <IdentityRail status={props.status} />
      </div>

      {/* Host tab bar — Home/hostname + connection pip (+ awaiting). Padi/Kaval
       *  live in the host diagnostics popover (click the status pip). */}
      <div class="flex-1 min-w-0 flex items-end pointer-events-none">
        <HostSelectorStrip />
      </div>

      {/* Control cluster: recorder → maximize → dock → inspector → settings
       *  → ⌘K. Buttons share the chrome icon hover/focus language.
       *  These are TOOLBAR icons, not tab-row marks, so they sit vertically
       *  CENTERED in the full header (symmetric top/bottom padding) rather
       *  than riding the tab baseline. `-mt-2 h-10` cancels the header's
       *  `pt-2` and spans the whole 40px so `items-center` lands them dead
       *  centre. */}
      <div class="-mt-2 flex h-10 items-center gap-2 shrink-0">
        <RecordButton />
        <Tip label={focusLabel()}>
          <button
            type="button"
            data-testid="focus-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": held(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg":
                !held() && canFocus(),
              "text-fg-3/40 cursor-not-allowed": !canFocus(),
            }}
            data-active={held() ? "" : undefined}
            disabled={!canFocus()}
            onClick={() => focusTile.toggle()}
            aria-label={focusLabel()}
          >
            <Show
              when={held()}
              fallback={<MaximizeIcon class="w-3.5 h-3.5" />}
            >
              <RestoreIcon class="w-3.5 h-3.5" />
            </Show>
          </button>
        </Tip>
        <Tip
          label={`Toggle dock (${formatKeybind(ACTIONS.toggleDock.keybind)})`}
        >
          <button
            type="button"
            data-testid="dock-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": dockExpanded(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg": !dockExpanded(),
            }}
            data-active={dockExpanded() ? "" : undefined}
            onClick={toggleRailCards}
            aria-label="Toggle dock"
          >
            <DockToggleIcon active={dockExpanded()} />
          </button>
        </Tip>
        <Tip
          label={`${ACTIONS.toggleRightPanel.label} (${formatKeybind(ACTIONS.toggleRightPanel.keybind)})`}
        >
          <button
            type="button"
            data-testid="inspector-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": rightPanel.panelOpen(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg":
                rightPanel.hasTerminals() && !rightPanel.panelOpen(),
              "text-fg-3/40 cursor-not-allowed": !rightPanel.hasTerminals(),
            }}
            data-active={rightPanel.panelOpen() ? "" : undefined}
            // Dead on an empty workspace: there's no panel to reveal, so the
            // toggle joins the maximize button in being disabled until a
            // terminal exists (the keybind/palette no-op via togglePanel too).
            disabled={!rightPanel.hasTerminals()}
            onClick={() => rightPanel.togglePanel()}
            aria-label={ACTIONS.toggleRightPanel.label}
          >
            <InspectorToggleIcon active={rightPanel.panelOpen()} />
          </button>
        </Tip>
        <div class="pointer-events-auto">
          <Tip label="Settings">
            <button
              type="button"
              ref={settingsTriggerRef}
              data-testid="settings-trigger"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              <SettingsIcon />
            </button>
          </Tip>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            triggerRef={settingsTriggerRef}
          />
        </div>
        <Tip label="Command palette">
          <button
            type="button"
            data-testid="palette-trigger"
            class="pointer-events-auto h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette()}
          >
            <Kbd>{formatKeybind(ACTIONS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
      </div>
    </header>
  );
};

export default ChromeBar;
