/**
 * Command palette — searchable overlay for terminal and theme actions.
 *
 * Always mounted via ModalDialog (forceMount). Keyboard navigation handled
 * internally with capture-phase listener to intercept before terminal.
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
import { makeEventListener } from "@solid-primitives/event-listener";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";

/** A command that can be executed from the palette. */
export interface PaletteCommand {
  name: string;
  onSelect: () => void;
  /** If set, command is hidden unless the query starts with this prefix. */
  showOnPrefix?: string;
}

/** Ctrl+key → normalized key for readline-style navigation. */
const CTRL_KEY_MAP: Record<string, string> = { n: "ArrowDown", p: "ArrowUp" };

const CommandPalette: Component<{
  commands: Accessor<PaletteCommand[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    return props
      .commands()
      .filter(
        (cmd) =>
          (!cmd.showOnPrefix || q.startsWith(cmd.showOnPrefix.toLowerCase())) &&
          (!q || cmd.name.toLowerCase().includes(q)),
      );
  });

  function execute(cmd: PaletteCommand) {
    cmd.onSelect();
    props.onOpenChange(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!props.open) return;
    const items = filtered();
    const isCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const key = (isCtrl && CTRL_KEY_MAP[e.key]) || e.key;
    switch (key) {
      case "ArrowDown":
        if (items.length === 0) return;
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        if (items.length === 0) return;
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Tab":
        if (items.length === 0) return;
        setSelectedIndex((i) =>
          e.shiftKey
            ? (i - 1 + items.length) % items.length
            : (i + 1) % items.length,
        );
        break;
      case "Enter": {
        const selected = items[selectedIndex()];
        if (selected) execute(selected);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // Capture phase: intercept before terminal's keydown handler
  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  // Reset query and selection when opening
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setQuery(props.initialQuery ?? "");
          setSelectedIndex(0);
          requestAnimationFrame(() => inputRef?.focus());
        }
      },
    ),
  );

  // Reset selection when filter results change (defer: skip initial run)
  createEffect(on(filtered, () => setSelectedIndex(0), { defer: true }));

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        forceMount
        data-testid="command-palette"
        class="w-full max-w-md bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ height: "24rem" }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command..."
          class="w-full px-4 py-3 bg-surface-1 text-fg text-sm border-b border-edge-bright outline-none placeholder-fg-3"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="flex-1 min-h-0 overflow-y-auto">
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="px-4 py-3 text-sm text-fg-2">
                No matching commands
              </div>
            }
          >
            <ul class="py-1">
              <For each={filtered()}>
                {(cmd, i) => (
                  <li
                    class="px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2"
                    classList={{
                      "bg-surface-3 text-fg border-accent":
                        selectedIndex() === i(),
                      "text-fg-2 hover:bg-surface-2 border-transparent":
                        selectedIndex() !== i(),
                    }}
                    onMouseEnter={() => setSelectedIndex(i())}
                    onClick={() => execute(cmd)}
                  >
                    {cmd.name}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default CommandPalette;
