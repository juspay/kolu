/**
 * Command palette — searchable overlay for terminal and theme actions.
 *
 * Uses cmdk-solid for keyboard navigation and item selection,
 * wrapped in a Corvu Dialog for focus trapping and accessibility.
 * Filtering uses shouldFilter={false} to preserve the custom prefix-gating logic.
 */

import {
  type Component,
  type Accessor,
  createSignal,
  createMemo,
  createEffect,
  on,
  For,
  Show,
} from "solid-js";
import Dialog from "@corvu/dialog";
import { Command, useCommandState } from "cmdk-solid";

/** A command that can be executed from the palette. */
export interface PaletteCommand {
  name: string;
  onSelect: () => void;
  /** If set, command is hidden unless the query starts with this prefix. */
  showOnPrefix?: string;
}

/** Refocus the active terminal after a dialog closes. */
function refocusTerminal() {
  document
    .querySelector<HTMLElement>("[data-visible][data-terminal-id]")
    ?.click();
}

/** Palette item that applies selected styling via cmdk's data-selected attribute. */
const PaletteItem: Component<{
  value: string;
  onSelect: () => void;
}> = (props) => {
  const selectedValue = useCommandState((state) => state.value);
  return (
    <Command.Item
      class="px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2"
      classList={{
        "bg-surface-3 text-fg border-accent": selectedValue() === props.value,
        "text-fg-2 hover:bg-surface-2 border-transparent":
          selectedValue() !== props.value,
      }}
      value={props.value}
      onSelect={props.onSelect}
    >
      {props.value}
    </Command.Item>
  );
};

const CommandPalette: Component<{
  commands: Accessor<PaletteCommand[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
}> = (props) => {
  const [search, setSearch] = createSignal("");

  // Custom filtering: prefix-gated commands only shown when query starts with prefix
  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    return props
      .commands()
      .filter(
        (cmd) =>
          (!cmd.showOnPrefix || q.startsWith(cmd.showOnPrefix.toLowerCase())) &&
          (!q || cmd.name.toLowerCase().includes(q)),
      );
  });

  // Reset search to initialQuery when opening
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) setSearch(props.initialQuery ?? "");
      },
    ),
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      restoreFocus={false}
      onFinalFocus={(e) => {
        e.preventDefault();
        refocusTerminal();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
        <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
          <Dialog.Content
            data-testid="command-palette"
            class="pointer-events-auto w-full max-w-md bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ height: "24rem" }}
          >
            <Command shouldFilter={false} loop>
              <Command.Input
                class="w-full px-4 py-3 bg-surface-1 text-fg text-sm border-b border-edge-bright outline-none placeholder-fg-3"
                placeholder="Type a command..."
                value={search()}
                onValueChange={setSearch}
              />
              <Command.List class="flex-1 min-h-0 overflow-y-auto">
                <Command.Empty class="px-4 py-3 text-sm text-fg-2">
                  No matching commands
                </Command.Empty>
                <For each={filtered()}>
                  {(cmd) => (
                    <PaletteItem
                      value={cmd.name}
                      onSelect={() => {
                        cmd.onSelect();
                        props.onOpenChange(false);
                      }}
                    />
                  )}
                </For>
              </Command.List>
            </Command>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
};

export default CommandPalette;
