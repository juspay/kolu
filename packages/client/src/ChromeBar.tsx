/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Left → right: quiet Kolu mark, host tab strip (primary multi-host
 *  nav; Padi/Kaval dual marks ride each host tab), global control
 *  cluster (recorder, maximize, dock, inspector, settings, command palette).
 *  The live-terminal navigator lives on the dock at the canvas's left edge
 *  (#903) — not here.
 *
 *  Two positioning modes, switched on `posture.mode()`:
 *  - Tiled (default): absolute overlay above the canvas with a solid
 *    chrome band tinted by the hostname-derived PWA theme color over the
 *    app base surface, so installed-window chrome and in-app header belong
 *    together. When the right panel is open, the overlay's right edge
 *    stops at the panel's left edge (via inline `right: panelSize * 100vw`)
 *    so the controls cluster doesn't sit on top of the panel's tab bar.
 *  - Maximized mode: docked in flex flow so the maximized terminal
 *    owns the rest of the viewport without the terminal's own title
 *    bar overlapping the chrome.
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { dockExpanded, toggleRailCards } from "./canvas/dock/Dock";
import { posturedActionLabel, useViewPosture } from "./canvas/useViewPosture";
import HostSelectorStrip from "./host/HostSelectorStrip";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
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
  themeColor?: string;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  // Dock only when the terminal is maximized, so its own title bar
  // doesn't collide with the chrome. Panel-open stays on the floating
  // overlay — the `right:` offset below keeps controls off the panel.
  const docked = createMemo(() => posture.mode() === "maximized");

  // Gate the maximize affordance on a tile existing (posture's single
  // source of truth) so the button never disagrees with `mode()`'s guard.
  const canMaximize = posture.canMaximize;

  // The maximize toggle's affordance describes the action a click performs,
  // so both the tooltip and the aria-label read from one source and can't
  // drift out of sync with the posture.
  const maximizeLabel = createMemo(() => posturedActionLabel(posture.mode()));

  const chromeStyle = createMemo<JSX.CSSProperties>(() => {
    const themed: JSX.CSSProperties = props.themeColor
      ? { "--chrome-theme-color": props.themeColor }
      : {};
    return {
      ...themed,
      ...(docked()
        ? {}
        : {
            // Stop the floating chrome's right edge at the right
            // panel's left edge so the controls cluster (inspector,
            // settings, ⌘K) doesn't sit on top of the panel's tab
            // bar. `panelSize` is `@corvu/resizable`'s [0..1] fraction
            // of *the Resizable container's* width — treating it as a
            // fraction of viewport width is only correct because the
            // host Resizable in `App.tsx` spans the full viewport in
            // tiled mode (the Dock floats `position: absolute`, the
            // canvas-container is the Resizable's left panel).
            // Maintained by convention across the two files — if a
            // sibling outside the Resizable ever shrinks the
            // container, switch to a measured pixel offset or a
            // host-published CSS custom property.
            // `panelOpen()` (not raw `collapsed()`) so an empty workspace —
            // where the panel host isn't even mounted (App's `showEmpty`)
            // — reserves no width here. Otherwise the cluster floats 25vw
            // shy of the right edge with nothing filling the gap.
            right: rightPanel.panelOpen()
              ? `${rightPanel.panelSize() * 100}vw`
              : 0,
          }),
    };
  });

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={docked() ? "" : undefined}
      // Solid chrome owns this strip's pointer area. Individual controls still
      // carry their own pointer/focus classes, but empty header space should
      // behave like header, not click through to the canvas behind it.
      class="chrome-bar-surface flex h-10 items-stretch gap-3 border-b border-edge/80 bg-surface-0 px-3 pt-2 pb-0 shadow-sm shadow-black/20 select-none pointer-events-auto transition-colors duration-150"
      // z-50 in BOTH modes. Without it on the docked branch, the
      // `backdrop-filter` we apply to the bar when the workspace
      // switcher is open creates a stacking context with auto z-index,
      // which traps the dropdown panel's own z-50 inside the bar — the
      // maximized tile (z-40 in the canvas) then paints on top of the
      // panel at the App root's auto-z layer (DOM order wins).
      classList={{
        "absolute top-0 left-0 z-50": !docked(),
        "relative shrink-0 z-50": docked(),
      }}
      style={chromeStyle()}
    >
      {/* Quiet Kolu mark — connection + dialogs; versions live in the dialog. */}
      <div class="flex h-8 shrink-0 items-center pointer-events-auto">
        <IdentityRail status={props.status} />
      </div>

      {/* Host tabs are primary nav. Every tab carries a fixed-width Padi/Kaval
       *  slot so daemon health is visible before switching and a host switch
       *  never reflows the strip — see HostDaemonChips.tsx. */}
      <div class="flex-1 min-w-0 flex items-end pointer-events-none">
        <HostSelectorStrip />
      </div>

      {/* Control cluster: recorder → maximize → dock → inspector → settings
       *  → ⌘K. Buttons share the chrome icon hover/focus language. */}
      <div class="flex h-8 items-center gap-2 shrink-0">
        <RecordButton />
        <Tip label={maximizeLabel()}>
          <button
            type="button"
            data-testid="maximize-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": docked(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg":
                !docked() && canMaximize(),
              "text-fg-3/40 cursor-not-allowed": !canMaximize(),
            }}
            data-active={docked() ? "" : undefined}
            disabled={!canMaximize()}
            onClick={() => posture.toggle()}
            aria-label={maximizeLabel()}
          >
            <Show
              when={docked()}
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
          label={`Toggle right panel (${formatKeybind(ACTIONS.toggleRightPanel.keybind)})`}
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
            aria-label="Toggle right panel"
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
