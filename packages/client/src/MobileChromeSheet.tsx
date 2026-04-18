/** MobileChromeSheet — pull-down chrome drawer for mobile.
 *
 *  On mobile the viewport is too tight for a persistent pill tree or
 *  control cluster, so chrome lives behind a pull-handle at the top of
 *  the terminal. Tap the handle to reveal this sheet. Contents mirror
 *  the desktop ChromeBar — logo + identity, pill tree (as a vertical
 *  tap list), global controls — but reflowed for touch.
 *
 *  Tap a branch row to switch terminals (auto-dismisses the sheet).
 *  Tap outside the sheet (the dimmed terminal beneath) to dismiss
 *  without switching. */

import { type Component, For, Show, createSignal } from "solid-js";
import { SettingsIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import SettingsPopover from "./settings/SettingsPopover";
import { useRightPanel } from "./right-panel/useRightPanel";
import { type PillRepoGroup, repoColor } from "./canvas/pillTreeOrder";
import { useTerminalStore } from "./terminal/useTerminalStore";
import type { TerminalId } from "kolu-common";
import type { WsStatus } from "./rpc/rpc";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const MobileChromeSheet: Component<{
  open: boolean;
  onDismiss: () => void;
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  groups: PillRepoGroup[];
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const store = useTerminalStore();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onDismiss();
  }

  return (
    <Show when={props.open}>
      {/* Backdrop — tap-anywhere-outside dismisses */}
      <div
        data-testid="mobile-chrome-backdrop"
        class="absolute inset-0 z-40 bg-black/40"
        onClick={props.onDismiss}
      />
      {/* Sheet — slides down from top. `absolute` anchored to the mobile
       *  tile view container so it doesn't cover the soft-keyboard bar. */}
      <div
        data-testid="mobile-chrome-sheet"
        class="absolute top-0 left-0 right-0 z-50 bg-surface-1 border-b border-edge shadow-xl max-h-[70%] overflow-y-auto"
      >
        {/* Header row: identity + connection + close */}
        <div class="flex items-center gap-2 px-3 py-2 border-b border-edge/50">
          <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
          <span class="font-semibold text-sm flex-1">{props.appTitle}</span>
          <span
            data-ws-status={props.status}
            class={`inline-block w-2 h-2 rounded-full ${statusStyles[props.status]}`}
            aria-label="Connection status"
          />
          <button
            data-testid="mobile-chrome-close"
            class="ml-2 text-fg-2 hover:text-fg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-2"
            onClick={props.onDismiss}
            aria-label="Close chrome"
          >
            ×
          </button>
        </div>

        {/* Pill tree — vertical list, one branch per row. Repo headers
         *  break up sections; tap any branch to switch and dismiss. */}
        <div class="flex flex-col py-1">
          <For each={props.groups}>
            {(group) => (
              <div class="flex flex-col">
                <div
                  class="px-3 pt-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide"
                  style={{ color: repoColor(group, store.getDisplayInfo) }}
                >
                  {group.repoName}
                </div>
                <For each={group.branches}>
                  {(b) => {
                    const active = () => store.activeId() === b.id;
                    const unread = () => store.isUnread(b.id);
                    return (
                      <button
                        data-testid="mobile-pill-branch"
                        data-terminal-id={b.id}
                        data-active={active() ? "" : undefined}
                        data-unread={unread() ? "" : undefined}
                        class="flex items-center gap-2 px-5 py-2 text-sm text-left transition-colors cursor-pointer active:bg-surface-2"
                        classList={{
                          "bg-accent/20 text-fg font-medium": active(),
                          "text-fg-2": !active(),
                        }}
                        onClick={() => handleSelect(b.id)}
                      >
                        <span
                          aria-hidden="true"
                          class="font-mono text-xs text-fg-3 select-none"
                        >
                          └─
                        </span>
                        <span class="flex-1 truncate">{b.label}</span>
                        <Show when={unread()}>
                          <span class="w-2 h-2 rounded-full bg-alert" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* Control cluster — palette, settings, inspector */}
        <div class="flex items-center gap-2 px-3 py-2 border-t border-edge/50">
          <button
            data-testid="palette-trigger"
            class="flex-1 h-9 flex items-center justify-center gap-2 text-sm text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
            onClick={() => {
              props.onOpenPalette();
              props.onDismiss();
            }}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
            <span>Palette</span>
          </button>
          <div>
            <button
              ref={settingsTriggerRef}
              data-testid="settings-trigger"
              class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
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
            data-testid="inspector-toggle"
            class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
            classList={{
              "bg-surface-3 text-fg": !rightPanel.collapsed(),
            }}
            onClick={() => {
              rightPanel.togglePanel();
              props.onDismiss();
            }}
            aria-label="Toggle inspector"
          >
            ⟳
          </button>
        </div>
      </div>
    </Show>
  );
};

export default MobileChromeSheet;
