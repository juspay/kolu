/** Header — unified app bar with identity, agent status, panel toggles, and controls.
 *  Burger is mobile-only; panel toggles are desktop-only. */

import { type Component, Show, createSignal, mergeProps } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { MenuIcon, SearchIcon, SettingsIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";
import AgentIndicator from "./sidebar/AgentIndicator";
import SettingsPopover from "./settings/SettingsPopover";
import { useTips } from "./settings/useTips";
import { CONTEXTUAL_TIPS } from "./settings/tips";
import { useRightPanel } from "./right-panel/useRightPanel";
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
  onToggleSidebar?: () => void;
  onAgentClick?: () => void;
  onSearch?: () => void;
  appTitle?: string;
  // Theme
  themeName?: string;
  onThemeClick?: () => void;
  // Canvas mode
  canvasMode?: boolean;
  onToggleCanvasMode?: () => void;
  // Panel toggles
  sidebarOpen?: boolean;
  hasSubPanel?: boolean;
  subPanelExpanded?: boolean;
  onToggleSubPanel?: () => void;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const { showTipOnce } = useTips();
  const rightPanel = useRightPanel();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [isFullscreen, setIsFullscreen] = createSignal(
    !!document.fullscreenElement,
  );

  // Sync fullscreen state with browser — auto-cleaned up on component disposal
  makeEventListener(document, "fullscreenchange", () =>
    setIsFullscreen(!!document.fullscreenElement),
  );

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  return (
    <header class="flex items-center h-10 shrink-0 bg-surface-1 border-b border-edge">
      {/* Zone A: Identity — burger is mobile-only */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <Tip label="Toggle sidebar">
          <button
            data-testid="sidebar-toggle"
            class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onToggleSidebar?.()}
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
        {/* Canvas/Focus mode toggle */}
        <Tip label={props.canvasMode ? "Focus mode" : "Canvas mode"}>
          <button
            data-testid="canvas-mode-toggle"
            class="h-7 px-2 text-xs rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "bg-accent/20 text-accent": props.canvasMode,
              "text-fg-2 hover:text-fg hover:bg-surface-2": !props.canvasMode,
            }}
            onClick={() => props.onToggleCanvasMode?.()}
          >
            {props.canvasMode ? "⇔ Canvas" : "⇔ Focus"}
          </button>
        </Tip>
        {/* Fullscreen toggle */}
        <Tip label={isFullscreen() ? "Exit fullscreen" : "Fullscreen"}>
          <button
            data-testid="fullscreen-toggle"
            class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={toggleFullscreen}
          >
            <Show
              when={!isFullscreen()}
              fallback={
                <svg
                  class="w-3.5 h-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <polyline points="5,2 2,2 2,5" />
                  <polyline points="11,14 14,14 14,11" />
                  <line x1="2" y1="2" x2="6" y2="6" />
                  <line x1="14" y1="14" x2="10" y2="10" />
                </svg>
              }
            >
              <svg
                class="w-3.5 h-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <polyline points="10,2 14,2 14,6" />
                <polyline points="6,14 2,14 2,10" />
                <line x1="14" y1="2" x2="9" y2="7" />
                <line x1="2" y1="14" x2="7" y2="9" />
              </svg>
            </Show>
          </button>
        </Tip>
        {/* Panel toggle icons — desktop only */}
        <div class="hidden sm:flex items-center gap-0.5">
          <PanelToggleIcon
            orientation="left"
            active={props.sidebarOpen}
            label={`Toggle sidebar (${formatKeybind(SHORTCUTS.commandPalette.keybind)})`}
            onClick={() => props.onToggleSidebar?.()}
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
