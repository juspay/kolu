/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Carries app identity (logo + connection dot) on the left and the
 *  global control cluster (recorder, inspector, settings, command
 *  palette) on the right. The live-terminal navigator moved to the
 *  dock at the canvas's left edge (#903), so the chrome bar
 *  no longer hosts a workspace switcher slot.
 *
 *  Two positioning modes, switched on `posture.mode()`:
 *  - Tiled (default): absolute overlay above the canvas. Pure
 *    transparent so the grid reads through and the chrome looks like
 *    it floats ON the canvas, not capping it. When the right panel
 *    is open, the overlay's right edge stops at the panel's left
 *    edge (via inline `right: panelSize * 100vw`) so the controls
 *    cluster doesn't sit on top of the panel's tab bar.
 *  - Maximized mode: docked in flex flow so the maximized terminal
 *    owns the rest of the viewport without the terminal's own title
 *    bar overlapping the chrome.
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import { type Component, createMemo, createSignal, Show } from "solid-js";
import { dockExpanded, toggleRailCards } from "./canvas/dock/Dock";
import { useViewPosture } from "./canvas/useViewPosture";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import { type DaemonChipState, daemonBuildIds } from "./wire";
import SettingsPopover from "./settings/SettingsPopover";
import {
  DockToggleIcon,
  InspectorToggleIcon,
  MaximizeIcon,
  RestoreIcon,
  SettingsIcon,
  TerminalIcon,
} from "./ui/Icons";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Per-state look + copy for the always-visible PTY status chip. `clickable`
 *  gates whether the chip opens the restart confirm — only the actionable
 *  states (outdated/dead) do; a healthy/connecting daemon is a passive glyph.
 *  `dotClass` is the small trailing indicator (omitted when empty). */
const ptyChipStyles: Record<
  DaemonChipState,
  { glyph: string; dotClass: string; label: string; clickable: boolean }
> = {
  connected: {
    glyph: "text-fg-3",
    dotClass: "",
    label: "Local PTY daemon — connected",
    clickable: false,
  },
  outdated: {
    glyph: "text-warning",
    dotClass: "bg-warning animate-pulse",
    label: "A newer terminal host is available — restart the local PTY daemon",
    clickable: true,
  },
  dead: {
    glyph: "text-danger",
    dotClass: "bg-danger",
    label: "Local PTY daemon disconnected — terminals may be unavailable",
    clickable: true,
  },
  connecting: {
    glyph: "text-fg-3 animate-pulse",
    dotClass: "",
    label: "Local PTY daemon — connecting…",
    clickable: false,
  },
};

/** Short-form a build id for the always-on readout: the nix store hash's
 *  leading 7 chars (`b72d6da`), a dev entry-dir's basename, or `—` when there's
 *  no live daemon. Full id is in the tooltip. */
function shortId(id: string | null): string {
  if (!id) return "—";
  const storeHash = /^([a-z0-9]{7})/.exec(id);
  if (storeHash) return storeHash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

// Shared base for the square icon toggles in the control cluster
// (maximize, dock, inspector). Active/idle coloring is layered on via
// each button's own `classList`. Keep ring/size tweaks here so all
// three toggles stay in lockstep.
const toggleBtnClass =
  "pointer-events-auto hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const ChromeBar: Component<{
  status: WsStatus;
  /** Health of the local PTY-host daemon — drives the always-visible PTY
   *  status chip. Distinct from `status` (the WebSocket dot): this is a
   *  terminal-glyph affordance, not a connection dot. */
  daemonState: DaemonChipState;
  /** Open the restart-daemon confirm (the chip + the ⌘K command share it). */
  onRequestDaemonRestart: () => void;
  onOpenPalette: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  // Dock only when the terminal is maximized, so its own title bar
  // doesn't collide with the chrome. Panel-open stays on the floating
  // overlay — the `right:` offset below keeps controls off the panel.
  const docked = createMemo(() => posture.mode() === "maximized");

  // The maximize toggle's affordance describes the action a click performs,
  // so both the tooltip and the aria-label read from one source and can't
  // drift out of sync with the posture.
  const maximizeLabel = createMemo(() =>
    docked() ? "Restore canvas" : "Maximize terminal",
  );

  // Look + copy for the PTY status chip, resolved from the daemon's state.
  const ptyChip = createMemo(() => ptyChipStyles[props.daemonState]);

  // Full build ids for the always-on readout's tooltip (short form is shown
  // inline; the tooltip carries the untruncated ids for copy/diagnosis).
  const ptyBuildIdLabel = () => {
    const { server, daemon } = daemonBuildIds();
    return `kolu-server pty-host build: ${server || "?"} · daemon: ${daemon ?? "(none — no live daemon)"}`;
  };

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={docked() ? "" : undefined}
      // pointer-events-none on the root so the transparent gaps don't
      // eat clicks meant for the canvas under the overlay. Interactive
      // children (identity row, workspace switcher, control cluster) re-enable
      // pointer events on themselves.
      class="chrome-bar-surface flex items-center gap-3 px-3 py-2 select-none pointer-events-none transition-colors duration-150"
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
      style={
        docked()
          ? undefined
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
              right: rightPanel.collapsed()
                ? 0
                : `${rightPanel.panelSize() * 100}vw`,
            }
      }
    >
      {/* Identity: logo (→ kolu.dev) + connection dot. App name lives as
       *  a corner watermark on the canvas, not in the chrome. */}
      <div class="flex items-center gap-2 shrink-0 pointer-events-auto">
        <a
          href="https://kolu.dev"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center"
          aria-label="kolu.dev"
        >
          <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        </a>
        <Tip label="Connection status">
          <span
            data-ws-status={props.status}
            class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
          />
        </Tip>
        {/* PTY status chip — always visible, distinct from the WebSocket dot:
         *  a terminal glyph (not a dot) so it never reads as a second
         *  connection state. State drives glyph color, the trailing indicator,
         *  the tooltip, and whether a click opens the restart confirm. The
         *  inner `pty-update-pending` testid renders ONLY while outdated, so
         *  the e2e nudge visible/hidden assertions still hold around the
         *  permanent chip. */}
        <Tip label={ptyChip().label}>
          <button
            type="button"
            data-testid="pty-status"
            data-state={props.daemonState}
            class="pointer-events-auto flex items-center gap-1 h-5 pl-1 pr-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              [`hover:bg-surface-2 cursor-pointer ${ptyChip().glyph}`]:
                ptyChip().clickable,
              [`cursor-default ${ptyChip().glyph}`]: !ptyChip().clickable,
            }}
            aria-label={ptyChip().label}
            disabled={!ptyChip().clickable}
            onClick={() => {
              if (ptyChip().clickable) props.onRequestDaemonRestart();
            }}
          >
            <Show
              when={props.daemonState === "outdated"}
              fallback={<TerminalIcon class="w-3.5 h-3.5" />}
            >
              <span data-testid="pty-update-pending" class="flex items-center">
                <TerminalIcon class="w-3.5 h-3.5" />
              </span>
            </Show>
            <Show when={ptyChip().dotClass}>
              <span class={`w-1.5 h-1.5 rounded-full ${ptyChip().dotClass}`} />
            </Show>
          </button>
        </Tip>
        {/* Build-id readout — always visible while R4c is being proven out, so
         *  the daemon's currency is glanceable at all times (not just when
         *  outdated). `srv <id>` is this kolu-server's pty-host build; `pty
         *  <id>` is the live daemon's. They match in steady state; on a deploy
         *  that moved pty-host code the daemon lags until restarted (amber). */}
        <Tip label={ptyBuildIdLabel()}>
          <span
            data-testid="pty-build-ids"
            class="hidden sm:flex items-center gap-1 font-mono text-[10px] leading-none text-fg-3 pointer-events-auto select-none"
            classList={{ "text-warning": props.daemonState === "outdated" }}
          >
            <span>srv {shortId(daemonBuildIds().server)}</span>
            <span class="text-fg-3/50">·</span>
            <span>pty {shortId(daemonBuildIds().daemon)}</span>
          </span>
        </Tip>
      </div>

      {/* Middle spacer — pointer-events pass through to whatever the
       *  canvas or right panel is showing underneath. The workspace
       *  switcher used to live here; with the dock owning the
       *  navigator, the chrome bar is just identity + global controls. */}
      <div class="flex-1 min-w-0 pointer-events-none" />

      {/* Control cluster: inspector → settings → ⌘K. Cluster wrapper
       *  itself stays pointer-events-none so the gap-2 spaces and any
       *  area covered when the cluster overlaps the right panel pass
       *  clicks through; each button re-enables pointer-events-auto. */}
      <div class="flex items-center gap-2 shrink-0">
        <RecordButton />
        <Tip label={maximizeLabel()}>
          <button
            type="button"
            data-testid="maximize-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": docked(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg": !docked(),
            }}
            data-active={docked() ? "" : undefined}
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
          label={`Toggle inspector (${formatKeybind(ACTIONS.toggleRightPanel.keybind)})`}
        >
          <button
            type="button"
            data-testid="inspector-toggle"
            class={toggleBtnClass}
            classList={{
              "bg-surface-2 text-fg": !rightPanel.collapsed(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg":
                rightPanel.collapsed(),
            }}
            data-active={!rightPanel.collapsed() ? "" : undefined}
            onClick={() => rightPanel.togglePanel()}
            aria-label="Toggle inspector"
          >
            <InspectorToggleIcon active={!rightPanel.collapsed()} />
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
