import {
  type Component,
  createSignal,
  createMemo,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";

export interface Command {
  id: string;
  name: string;
  onSelect: () => void;
}

const CommandPalette: Component<{
  commands: Command[];
  onClose: () => void;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    if (!q) return props.commands;
    return props.commands.filter((cmd) => cmd.name.toLowerCase().includes(q));
  });

  function handleKeyDown(e: KeyboardEvent) {
    const items = filtered();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (items[selectedIndex()]) {
          items[selectedIndex()].onSelect();
          props.onClose();
        }
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  }

  // Reset selection when filter changes
  const trackFiltered = () => filtered().length;
  createMemo(() => {
    trackFiltered();
    setSelectedIndex(0);
  });

  // Focus input on mount via ref callback
  requestAnimationFrame(() => inputRef?.focus());

  // Close on click outside
  makeEventListener(document, "mousedown", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-testid='command-palette']")) {
      props.onClose();
    }
  });

  // Prevent terminal from capturing keystrokes while palette is open
  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div class="fixed inset-0 bg-black/50" />
      <div
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
                  onClick={() => {
                    cmd.onSelect();
                    props.onClose();
                  }}
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
