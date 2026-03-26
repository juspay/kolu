/**
 * Command palette — searchable overlay for terminal and theme actions.
 *
 * Supports nested commands (groups with children) à la Raycast:
 * - Empty query: browse the current level, drill into groups with Enter
 * - Non-empty query: flatten all leaves and search globally
 * - Backspace on empty query: navigate back up
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
import { type Keybind, formatKeybind } from "./keyboard";

/** A command that can be executed from the palette, or a group containing sub-commands. */
export interface PaletteCommand {
  name: string;
  /** Execute this command (leaf). Mutually exclusive with `children`. */
  onSelect?: () => void;
  /** Nested sub-commands (group). Static array or accessor for dynamic lists. */
  children?: PaletteCommand[] | (() => PaletteCommand[]);
  /** If set, command is hidden unless the query starts with this prefix. */
  showOnPrefix?: string;
  /** Keyboard shortcut to display alongside the command name. */
  keybind?: Keybind;
}

/** Resolve children, handling both static arrays and accessors. */
function resolveChildren(cmd: PaletteCommand): PaletteCommand[] {
  if (!cmd.children) return [];
  return typeof cmd.children === "function" ? cmd.children() : cmd.children;
}

/** Whether a command is a group (has children rather than an action). */
function isGroup(cmd: PaletteCommand): boolean {
  return cmd.children !== undefined;
}

/** Ctrl+key → normalized key for readline-style navigation. */
const CTRL_KEY_MAP: Record<string, string> = { n: "ArrowDown", p: "ArrowUp" };

const CommandPalette: Component<{
  commands: Accessor<PaletteCommand[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
  /** If set, auto-drill into the group with this name on open. */
  initialGroup?: string;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // Navigation path: list of group commands we've drilled into
  const [path, setPath] = createSignal<PaletteCommand[]>([]);

  /** Commands at the current navigation level. */
  const currentItems = createMemo(() => {
    const p = path();
    if (p.length === 0) return props.commands();
    return resolveChildren(p[p.length - 1]!);
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    // Always search within the current level only (groups + leaves)
    return currentItems().filter(
      (cmd) =>
        (!cmd.showOnPrefix || q.startsWith(cmd.showOnPrefix.toLowerCase())) &&
        (!q || cmd.name.toLowerCase().includes(q)),
    );
  });

  function drillIn(cmd: PaletteCommand) {
    setPath((p) => [...p, cmd]);
    setQuery("");
    setSelectedIndex(0);
  }

  function drillOut() {
    setPath((p) => p.slice(0, -1));
    setQuery("");
    setSelectedIndex(0);
  }

  function navigateTo(depth: number) {
    setPath((p) => p.slice(0, depth));
    setQuery("");
    setSelectedIndex(0);
  }

  function execute(cmd: PaletteCommand) {
    if (isGroup(cmd)) {
      drillIn(cmd);
    } else {
      cmd.onSelect?.();
      props.onOpenChange(false);
    }
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
      case "Backspace":
        // Drill out when backspacing on empty query
        if (query() === "" && path().length > 0) {
          drillOut();
          break;
        }
        return;
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

  // Reset all state when opening; auto-drill into initialGroup if set
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setQuery(props.initialQuery ?? "");
          setSelectedIndex(0);
          const group = props.initialGroup
            ? props.commands().find((c) => c.name === props.initialGroup)
            : undefined;
          setPath(group ? [group] : []);
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
        class="w-md bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ height: "24rem" }}
      >
        {/* Breadcrumb — visible when drilled into a group */}
        <Show when={path().length > 0}>
          <nav class="flex items-center gap-1 px-4 pt-2 text-xs text-fg-3">
            <button
              class="hover:text-fg transition-colors"
              onClick={() => navigateTo(0)}
            >
              Commands
            </button>
            <For each={path()}>
              {(segment, i) => (
                <>
                  <span class="text-fg-3">›</span>
                  <button
                    class="hover:text-fg transition-colors"
                    onClick={() => navigateTo(i() + 1)}
                  >
                    {segment.name}
                  </button>
                </>
              )}
            </For>
          </nav>
        </Show>
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
                    class="flex items-center px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2"
                    classList={{
                      "bg-surface-3 text-fg border-accent":
                        selectedIndex() === i(),
                      "text-fg-2 hover:bg-surface-2 border-transparent":
                        selectedIndex() !== i(),
                    }}
                    onMouseEnter={() => setSelectedIndex(i())}
                    onClick={() => execute(cmd)}
                  >
                    <span class="truncate">{cmd.name}</span>
                    <Show when={isGroup(cmd)}>
                      <span class="ml-auto shrink-0 pl-4 text-xs text-fg-3">
                        →
                      </span>
                    </Show>
                    <Show when={!isGroup(cmd) && cmd.keybind}>
                      <kbd class="ml-auto shrink-0 pl-4 text-xs text-fg-3 font-mono">
                        {formatKeybind(cmd.keybind!)}
                      </kbd>
                    </Show>
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
