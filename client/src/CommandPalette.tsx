/**
 * Command palette — searchable overlay for terminal and theme actions.
 *
 * Always mounted. Owns Cmd/Ctrl+K shortcut and keyboard navigation.
 * Open state is controlled by the parent via open/onOpenChange props
 * so other components (e.g. Header button) can trigger it.
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
import { isPlatformModifier } from "./keyboard";

/** A command that can be executed from the palette. */
export interface Command {
  name: string;
  onSelect: () => void;
}

const CommandPalette: Component<{
  commands: Accessor<Command[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  let panelRef!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    const cmds = props.commands();
    if (!q) return cmds;
    return cmds.filter((cmd) => cmd.name.toLowerCase().includes(q));
  });

  function execute(cmd: Command) {
    cmd.onSelect();
    props.onOpenChange(false);
  }

  // Cmd/Ctrl+K to toggle palette — works even when closed
  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (isPlatformModifier(e) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenChange(!props.open);
      }
    },
    { capture: true },
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (!props.open) return;
    const items = filtered();
    const isCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const key =
      isCtrl && e.key === "n"
        ? "ArrowDown"
        : isCtrl && e.key === "p"
          ? "ArrowUp"
          : e.key;
    switch (key) {
      case "ArrowDown":
        if (items.length === 0) return;
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        if (items.length === 0) return;
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter": {
        const selected = items[selectedIndex()];
        if (selected) execute(selected);
        break;
      }
      case "Escape":
        props.onOpenChange(false);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // Capture phase: intercept before ghostty's keydown handler
  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  // Close on click outside the palette panel
  makeEventListener(document, "mousedown", (e) => {
    if (props.open && !panelRef.contains(e.target as Node)) {
      props.onOpenChange(false);
    }
  });

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
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        <div class="fixed inset-0 bg-black/50" />
        <div
          ref={panelRef}
          data-testid="command-palette"
          class="relative z-10 w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg shadow-2xl overflow-hidden"
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command..."
            class="w-full px-4 py-3 bg-slate-800 text-white text-sm border-b border-slate-600 outline-none placeholder-slate-400"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="px-4 py-3 text-sm text-slate-400">
                No matching commands
              </div>
            }
          >
            <ul class="max-h-64 overflow-y-auto py-1">
              <For each={filtered()}>
                {(cmd, i) => (
                  <li
                    class="px-4 py-2 text-sm cursor-pointer transition-colors"
                    classList={{
                      "bg-slate-600 text-white": selectedIndex() === i(),
                      "text-slate-300 hover:bg-slate-700":
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
      </div>
    </Show>
  );
};

export default CommandPalette;
