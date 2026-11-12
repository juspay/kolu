/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Left → right: quiet Kolu mark, host tab strip (primary multi-host
 *  nav; Padi/Kaval dual marks ride each host tab), the `◆ Conductor`
 *  entry that closes that row (same row, not a host tab — see
 *  `ConductorTab`), global control cluster (recorder, view mode,
 *  dock, inspector, settings, command palette).
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
 *  `posture.layout()` no longer changes the bar's positioning; it only drives
 *  the `data-maximized` marker. The maximize/restore affordance is one segment
 *  of the two-way `ModeControl` (canvas · maximized), which describes the HOST
 *  TAB underneath and nothing else.
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import { type Component, createMemo } from "solid-js";
import { dockExpanded, toggleRailCards } from "./canvas/dock/Dock";
import { useViewPosture } from "./canvas/useViewPosture";
import HostSelectorStrip from "./host/HostSelectorStrip";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import ModeControl from "./conductor/ModeControl";
import ConductorTab from "./conductor/ConductorTab";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { setSettingsOpen, settingsOpen } from "./settings/useSettingsOpen";
import { DockToggleIcon, InspectorToggleIcon, SettingsIcon } from "./ui/Icons";
import IdentityRail from "./ui/IdentityRail";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";

// Shared base for the square icon toggles in the control cluster
// (dock, inspector). Active/idle coloring is layered on via each button's own
// `classList`. Keep ring/size tweaks here so both toggles stay in lockstep.
const toggleBtnClass =
  "pointer-events-auto hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const ChromeBar: Component<{
  status: WsStatus;
  onOpenPalette: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;

  // True when the terminal is maximized. The header is full-width docked in
  // BOTH postures now (see the module comment), so this drives only the
  // `data-maximized` marker.
  const docked = createMemo(() => posture.layout() === "maximized");

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={docked() ? "" : undefined}
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

      {/* The one special destination in the tab row — pinned at its end, where
       *  the host tabs stop. It is CENTRED in the full header exactly as the
       *  control cluster below is (`-mt-2 h-10`), not riding the tab baseline:
       *  it is a pill beside the posture control, and a pill four pixels lower
       *  than its neighbour reads as something somebody forgot to align. */}
      <div class="-mt-2 flex h-10 shrink-0 items-center">
        <ConductorTab />
      </div>

      {/* Control cluster: recorder → view mode → dock → inspector → settings
       *  → ⌘K. Buttons share the chrome icon hover/focus language.
       *  These are TOOLBAR icons, not tab-row marks, so they sit vertically
       *  CENTERED in the full header (symmetric top/bottom padding) rather
       *  than riding the tab baseline. `-mt-2 h-10` cancels the header's
       *  `pt-2` and spans the whole 40px so `items-center` lands them dead
       *  centre.
       *
       *  The lone maximize toggle became the two-way `ModeControl`: canvas and
       *  maximized are mutually exclusive views of the host tab underneath,
       *  and two separate toggles would let a person spell a state the layout
       *  does not have. */}
      <div class="-mt-2 flex h-10 items-center gap-2 shrink-0">
        <RecordButton />
        <ModeControl />
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
