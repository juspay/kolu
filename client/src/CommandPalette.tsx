/**
 * Command palette — searchable overlay for terminal and theme actions.
 *
 * Uses cmdk-solid for keyboard navigation and item selection,
 * wrapped in a shared ModalDialog for focus trapping and accessibility.
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
} from "solid-js";
import Dialog from "@corvu/dialog";
import { Command } from "cmdk-solid";
import ModalDialog from "./ModalDialog";

/** A command that can be executed from the palette. */
export interface PaletteCommand {
  name: string;
  onSelect: () => void;
  /** If set, command is hidden unless the query starts with this prefix. */
  showOnPrefix?: string;
}

/** Tailwind classes for cmdk items — selected state via data-[selected=true] attribute. */
const ITEM_CLASS =
  "px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2 text-fg-2 hover:bg-surface-2 border-transparent data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg data-[selected=true]:border-accent";

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
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        forceMount
        data-testid="command-palette"
        class="w-full max-w-md bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden flex flex-col"
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
                <Command.Item
                  class={ITEM_CLASS}
                  value={cmd.name}
                  onSelect={() => {
                    cmd.onSelect();
                    props.onOpenChange(false);
                  }}
                >
                  {cmd.name}
                </Command.Item>
              )}
            </For>
          </Command.List>
        </Command>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default CommandPalette;
