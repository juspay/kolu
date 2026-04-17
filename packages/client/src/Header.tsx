/** Header — unified app bar with identity, agent status, panel toggles, and controls.
 *  Burger is mobile-only; panel toggles are desktop-only. */

import { type Component, Show, createSignal, mergeProps } from "solid-js";
import { MenuIcon, SearchIcon, SettingsIcon, GridIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";
import AgentIndicator from "./dock/AgentIndicator";
import SettingsPopover from "./settings/SettingsPopover";
import { useTips } from "./settings/useTips";
import { CONTEXTUAL_TIPS } from "./settings/tips";
import { useRightPanel } from "./right-panel/useRightPanel";
import {
  currentLayout,
  cycleLayoutPin,
  dockVisible,
  layoutPin,
  toggleDockVisible,
} from "./layout/useLayout";
import type { WsStatus } from "./rpc/rpc";
import type { TerminalMetadata } from "kolu-common";

/** WS connection status indicator colors. */
const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Panel toggle icon positions — maps orientation to SVG line coordinates. */
type PanelOrientation = "left" | "bottom" | "right";
const panelLineCoords: Record<
  PanelOrientation,
  [number, number, number, number]
> = {
  left: [9, 3, 9, 21],
  bottom: [3, 15, 21, 15],
  right: [15, 3, 15, 21],
};

/** Compact panel toggle icon — rect with a divider line. */
const PanelToggleIcon: Component<{
  orientation: PanelOrientation;
  active?: boolean;
  label: string;
  onClick?: () => void;
  "data-testid"?: string;
}> = (props) => {
  const [x1, y1, x2, y2] = panelLineCoords[props.orientation];
  return (
    <Tip label={props.label}>
      <button
        data-testid={props["data-testid"]}
        class="flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer"
        classList={{
          "bg-surface-2 text-fg": props.active,
          "text-fg-3 hover:bg-surface-2 hover:text-fg": !props.active,
        }}
        data-active={props.active ? "" : undefined}
        onClick={props.onClick}
        aria-label={props.label}
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1={x1} y1={y1} x2={x2} y2={y2} />
        </svg>
      </button>
    </Tip>
  );
};

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  meta?: TerminalMetadata | null;
  onAgentClick?: () => void;
  onSearch?: () => void;
  appTitle?: string;
  // Theme
  themeName?: string;
  onThemeClick?: () => void;
  // Panel toggles
  hasSubPanel?: boolean;
  subPanelExpanded?: boolean;
  onToggleSubPanel?: () => void;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const { showTipOnce } = useTips();
  const rightPanel = useRightPanel();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  /** Button label — "Auto: canvas" / "Auto: compact" when unpinned so the
   *  user can see which rendering they're getting, or a bare "Canvas" /
   *  "Compact" when explicitly pinned. */
  const layoutPinLabel = () => {
    const pin = layoutPin();
    if (pin === "auto") return `Auto: ${currentLayout()}`;
    return pin === "canvas" ? "Canvas" : "Compact";
  };

  const layoutPinTooltip = () => {
    const pin = layoutPin();
    const kb = formatKeybind(SHORTCUTS.toggleDock.keybind);
    const next =
      pin === "auto" ? "canvas" : pin === "canvas" ? "compact" : "auto";
    return `Layout: ${pin}. Click to pin ${next}. Toggle dock ${kb}.`;
  };

  return (
    <header class="flex items-center h-10 shrink-0 bg-surface-1 border-b border-edge">
      {/* Zone A: Identity — burger is mobile-only */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <Tip label="Toggle dock">
          <button
            data-testid="sidebar-toggle"
            class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => toggleDockVisible()}
          >
            <MenuIcon />
          </button>
        </Tip>
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm hidden sm:inline">
          {props.appTitle ?? "kolu"}
        </span>
      </div>

      {/* Zone B: Agent status — click opens inspector panel */}
      <div class="flex-1 min-w-0 flex items-center gap-1 px-2">
        <Show when={props.meta?.agent}>
          {(agent) => (
            <button
              class="cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => props.onAgentClick?.()}
            >
              <AgentIndicator agent={agent()} />
            </button>
          )}
        </Show>
      </div>

      {/* Zone C: Panel toggles → Theme → Search → Settings → ⌘K → Connection dot */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        {/* Layout pin toggle — desktop only. Cycles auto → canvas → compact.
         *  Hidden on mobile (<640px) because canvas layout is unusable there:
         *  the viewport forces compact regardless of pin, so a pin control
         *  would be UI theatre. */}
        <Tip label={layoutPinTooltip()}>
          <button
            data-testid="layout-pin-toggle"
            data-layout-pin={layoutPin()}
            data-current-layout={currentLayout()}
            class="hidden sm:flex h-7 px-2 items-center gap-1.5 text-xs rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "bg-accent/20 text-accent": layoutPin() !== "auto",
              "text-fg-2 hover:text-fg hover:bg-surface-2":
                layoutPin() === "auto",
            }}
            onClick={() => cycleLayoutPin()}
          >
            <GridIcon class="w-3 h-3" />
            {layoutPinLabel()}
          </button>
        </Tip>
        {/* Panel toggle icons — desktop only */}
        <div class="hidden sm:flex items-center gap-0.5">
          <PanelToggleIcon
            orientation="left"
            active={dockVisible()}
            label={`Toggle dock (${formatKeybind(SHORTCUTS.toggleDock.keybind)})`}
            onClick={() => toggleDockVisible()}
            data-testid="sidebar-toggle-desktop"
          />
          <PanelToggleIcon
            orientation="bottom"
            active={props.hasSubPanel && props.subPanelExpanded}
            label={`Toggle split (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
            onClick={() => props.onToggleSubPanel?.()}
          />
          <PanelToggleIcon
            orientation="right"
            active={!rightPanel.collapsed()}
            label={`Toggle inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
            onClick={() => rightPanel.togglePanel()}
          />
        </div>
        {props.themeName && (
          <Tip label={`Theme: ${props.themeName}`}>
            <button
              data-testid="theme-name"
              class="h-7 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2/50 hover:bg-surface-3/50 rounded-lg transition-colors cursor-pointer max-w-[14ch] truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => {
                props.onThemeClick?.();
                setTimeout(
                  () => showTipOnce(CONTEXTUAL_TIPS.themeFromPalette),
                  500,
                );
              }}
            >
              {props.themeName}
            </button>
          </Tip>
        )}
        <Tip
          label={`Find in terminal (${formatKeybind(SHORTCUTS.findInTerminal.keybind)})`}
        >
          <button
            class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onSearch?.()}
          >
            <SearchIcon />
          </button>
        </Tip>
        <div>
          <Tip label="Settings">
            <button
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
            data-testid="palette-trigger"
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette?.()}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
        <Tip label="Connection status">
          <div class="flex items-center gap-1.5" data-ws-status={props.status}>
            <span
              class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
            />
          </div>
        </Tip>
      </div>
    </header>
  );
};

export default Header;
