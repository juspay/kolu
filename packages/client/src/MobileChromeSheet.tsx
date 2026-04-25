/** MobileChromeSheet — content of the pull-down chrome drawer for mobile.
 *
 *  On mobile the viewport is too tight for a persistent pill tree or
 *  control cluster, so chrome lives behind a pull-handle at the top of
 *  the terminal. Tap or pull the handle to reveal this sheet. Contents
 *  mirror the desktop ChromeBar — logo + identity, pill tree (as a
 *  vertical tap list), global controls — but reflowed for touch.
 *
 *  Sheet machinery (open state, drag-to-dismiss, overlay, portal) is
 *  owned by `MobileTileView` via `@corvu/drawer`. This component only
 *  renders the sheet's contents; `onClose` is called after a user
 *  action (branch select, palette open, inspector toggle) so the
 *  parent can close the drawer. */

import type { TerminalId } from "kolu-common";
import { type Component, createSignal, For, Show } from "solid-js";
import { type PillRepoGroup, repoColor } from "./canvas/pillTreeOrder";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { SettingsIcon } from "./ui/Icons";
import Kbd from "./ui/Kbd";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const MobileChromeSheet: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  groups: PillRepoGroup[];
  onSelect: (id: TerminalId) => void;
  /** Close the drawer after the user takes an action (branch select,
   *  palette open, inspector toggle). The drawer is otherwise dismissed
   *  by drag-down or overlay tap, both handled by Corvu. */
  onClose: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const store = useTerminalStore();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onClose();
  }

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
          aria-label="Connection status"
        />
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
                      // stopPropagation on pointerdown keeps Corvu Drawer's
                      // drag-to-dismiss handler on Drawer.Content from
                      // claiming the gesture — without this, any micro-drag
                      // during a tap suppresses the click event.
                      onPointerDown={(e) => e.stopPropagation()}
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

      {/* Control cluster — palette, settings, inspector. Each button
       *  stops propagation on pointerdown so Corvu Drawer's drag handler
       *  on Drawer.Content can't claim the tap as the start of a drag
       *  (which would suppress the click). */}
      <div class="flex items-center gap-2 px-3 py-2 border-t border-edge/50">
        <button
          data-testid="palette-trigger"
          class="flex-1 h-9 flex items-center justify-center gap-2 text-sm text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            props.onOpenPalette();
            props.onClose();
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
          data-testid="inspector-toggle"
          class="h-9 w-9 flex items-center justify-center text-fg-2 bg-surface-2 rounded-lg border border-edge active:bg-surface-3"
          classList={{
            "bg-surface-3 text-fg": !rightPanel.collapsed(),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            rightPanel.togglePanel();
            props.onClose();
          }}
          aria-label="Toggle inspector"
        >
          ⟳
        </button>
      </div>
    </div>
  );
};

export default MobileChromeSheet;
