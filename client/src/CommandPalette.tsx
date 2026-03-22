import {
  type Component,
  createSignal,
  createMemo,
  createEffect,
  on,
  For,
  Show,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import type { ChromeColors } from "./theme";

/** A command that can be executed from the palette. */
export interface Command {
  name: string;
  onSelect: () => void;
}

/** Searchable command palette overlay — Cmd/Ctrl+K to open, Escape to close. */
const CommandPalette: Component<{
  commands: Command[];
  onClose: () => void;
  chrome?: ChromeColors;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  let panelRef!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    if (!q) return props.commands;
    return props.commands.filter((cmd) => cmd.name.toLowerCase().includes(q));
  });

  function execute(cmd: Command) {
    cmd.onSelect();
    props.onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    const items = filtered();
    switch (e.key) {
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
        props.onClose();
        break;
      default:
        return; // Let unhandled keys (typing) reach the input naturally
    }
    // Only reached for handled keys — prevent browser default and stop propagation to ghostty
    e.preventDefault();
    e.stopPropagation();
  }

  // Reset selection when filter results change (defer: skip initial run)
  createEffect(on(filtered, () => setSelectedIndex(0), { defer: true }));

  // Focus input on mount
  requestAnimationFrame(() => inputRef?.focus());

  // Close on click outside the palette panel
  makeEventListener(document, "mousedown", (e) => {
    if (!panelRef.contains(e.target as Node)) {
      props.onClose();
    }
  });

  // Capture phase: intercept before ghostty's keydown handler
  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div class="fixed inset-0 bg-black/50" />
      <div
        ref={panelRef}
        data-testid="command-palette"
        class="relative z-10 w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
        style={{
          "background-color": props.chrome?.surface,
          border: `1px solid ${props.chrome?.border}`,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command..."
          class="w-full px-4 py-3 text-sm outline-none"
          style={{
            "background-color": props.chrome?.surface,
            color: props.chrome?.text,
            "border-bottom": `1px solid ${props.chrome?.border}`,
          }}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Show
          when={filtered().length > 0}
          fallback={
            <div
              class="px-4 py-3 text-sm"
              style={{ color: props.chrome?.textMuted }}
            >
              No matching commands
            </div>
          }
        >
          <ul class="max-h-64 overflow-y-auto py-1">
            <For each={filtered()}>
              {(cmd, i) => (
                <li
                  class="px-4 py-2 text-sm cursor-pointer transition-colors"
                  style={{
                    "background-color":
                      selectedIndex() === i()
                        ? props.chrome?.activeBg
                        : "transparent",
                    color:
                      selectedIndex() === i()
                        ? props.chrome?.text
                        : props.chrome?.textMuted,
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
  );
};

export default CommandPalette;
