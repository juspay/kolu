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

import Dialog from "@corvu/dialog";
import { makeEventListener } from "@solid-primitives/event-listener";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { formatKeybind, type Keybind } from "./input/keyboard";
import { useTips } from "./settings/useTips";
import Kbd from "./ui/Kbd";
import ModalDialog from "./ui/ModalDialog";

/** A command that can be executed from the palette, or a group containing sub-commands. */
export interface PaletteCommand {
  kind?: "command";
  name: string;
  /** Secondary text shown after the name, de-emphasized. */
  description?: string;
  /** Execute this command (leaf). Mutually exclusive with `children`. */
  onSelect?: () => void;
  /** Nested sub-commands (group). Static array or accessor for dynamic lists. */
  children?: PaletteItem[] | (() => PaletteItem[]);
  /** Keyboard shortcut(s) to display alongside the command name. */
  keybind?: Keybind | Keybind[];
  /** Called when this item becomes the highlighted item during navigation. */
  onHighlight?: () => void;
  /** Called when leaving this group without executing a child (Escape, Backspace, breadcrumb). */
  onCancel?: () => void;
}

/** A non-interactive informational row shown inside a palette group. */
export interface PaletteHint {
  kind: "hint";
  text: string;
}

/** Anything renderable at a palette level — a command or a hint. */
export type PaletteItem = PaletteCommand | PaletteHint;

function isCommand(item: PaletteItem): item is PaletteCommand {
  return item.kind !== "hint";
}

function isHint(item: PaletteItem): item is PaletteHint {
  return item.kind === "hint";
}

/** Resolve children, handling both static arrays and accessors. */
function resolveChildren(cmd: PaletteCommand): PaletteItem[] {
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
  commands: Accessor<PaletteItem[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If set, auto-drill into the group with this name on open. */
  initialGroup?: string;
  /** When true, the backdrop is transparent so content behind is visible. */
  transparentOverlay?: boolean;
}> = (props) => {
  const { randomAmbientTip } = useTips();
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [ambientTip, setAmbientTip] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // Ignore mouseEnter until a real mouse move after opening (prevents cursor-under-palette hijack)
  let mouseActive = false;
  // Navigation path: list of group commands we've drilled into
  const [path, setPath] = createSignal<PaletteCommand[]>([]);

  /** Items at the current navigation level (may include hints).
   *
   *  Resolves the drilled-in path by **name** against the fresh
   *  `props.commands()` tree, not by object reference against the
   *  snapshot captured in `path()`. The parent createCommands memo
   *  re-runs whenever its reactive inputs change (e.g. server state
   *  push, terminal list update) and produces *new* PaletteCommand
   *  objects — the stored references in `path()` become stale within
   *  the same render, and resolving children against them would show
   *  the outdated group contents at the drilled-in level. By walking
   *  the current tree step-by-step via `.name` lookup, the drilled-in
   *  level always reflects the latest content. If a segment's name
   *  disappears from the fresh tree (e.g. a parent hidden by a
   *  visibility guard), fall back to the stale reference so the
   *  palette doesn't render an empty level mid-navigation. */
  const currentItems = createMemo((): PaletteItem[] => {
    const p = path();
    if (p.length === 0) return props.commands();
    let level: PaletteItem[] = props.commands();
    for (const segment of p) {
      const match = level.find(
        (item): item is PaletteCommand =>
          isCommand(item) && item.name === segment.name,
      );
      if (!match || !isGroup(match)) {
        // Segment no longer present in the current tree; fall back to
        // the stale reference to keep the level rendered. Happens e.g.
        // when a visibility guard hides a parent group while the user
        // is still drilled into it.
        return resolveChildren(p[p.length - 1]!);
      }
      level = resolveChildren(match);
    }
    return level;
  });

  /** Commands at the current level, filtered by the search query. Hints are excluded. */
  const filtered = createMemo((): PaletteCommand[] => {
    const q = query().toLowerCase();
    return currentItems()
      .filter(isCommand)
      .filter(
        (cmd) =>
          !q ||
          cmd.name.toLowerCase().includes(q) ||
          cmd.description?.toLowerCase().includes(q),
      );
  });

  /** Hints at the current level — rendered as non-interactive rows below the list. */
  const hintsAtLevel = createMemo((): PaletteHint[] =>
    currentItems().filter(isHint),
  );

  function drillIn(cmd: PaletteCommand) {
    setPath((p) => [...p, cmd]);
    setQuery("");
    setSelectedIndex(0);
  }

  function drillOut() {
    const p = path();
    p[p.length - 1]?.onCancel?.();
    setPath(p.slice(0, -1));
    setQuery("");
    setSelectedIndex(0);
  }

  function navigateTo(depth: number) {
    const p = path();
    for (const g of p.slice(depth)) g.onCancel?.();
    setPath(p.slice(0, depth));
    setQuery("");
    setSelectedIndex(0);
  }

  // Track whether the palette is closing due to a selection (skip onCancel).
  let didSelect = false;

  function execute(cmd: PaletteCommand) {
    if (isGroup(cmd)) {
      drillIn(cmd);
    } else {
      // Close first so the highlight effect stops tracking filtered(),
      // preventing onSelect's state changes from re-triggering a preview.
      didSelect = true;
      props.onOpenChange(false);
      cmd.onSelect?.();
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
        // Ignore Enter while modifier keys are held — the chord that opened
        // the palette (e.g. Cmd+Shift+Enter) would otherwise auto-repeat
        // and immediately confirm the first item.
        if (e.metaKey || e.ctrlKey || e.altKey) return;
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

  // Reset all state when opening; cancel groups on close (unless a command was selected)
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setQuery("");
          setSelectedIndex(0);
          setAmbientTip(randomAmbientTip());
          mouseActive = false;
          const group = props.initialGroup
            ? props
                .commands()
                .find(
                  (c): c is PaletteCommand =>
                    isCommand(c) && c.name === props.initialGroup,
                )
            : undefined;
          setPath(group ? [group] : []);
          didSelect = false;
          // forceMount keeps the dialog in the DOM, so Corvu's initialFocusEl
          // only fires on first mount. Re-focus explicitly on every open.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => inputRef.focus()),
          );
        } else {
          if (!didSelect) for (const g of path()) g.onCancel?.();
          didSelect = false;
        }
      },
    ),
  );

  // Reset selection when the user types (defer: skip initial run).
  // Intentionally tracks `query`, not `filtered` — filtered returns a new array
  // reference on every recomputation, so tracking it would reset the index whenever
  // upstream data (commands memo) recomputes in the background.
  createEffect(on(query, () => setSelectedIndex(0), { defer: true }));

  // Notify highlighted item when selection changes.
  // Uses on() for stable dependency tracking — bare createEffect would drop
  // filtered/selectedIndex tracking when props.open is false, creating
  // flickering dependency sets across open/close cycles.
  createEffect(
    on([filtered, selectedIndex], ([items, idx]) => {
      if (!props.open) return;
      items[idx]?.onHighlight?.();
    }),
  );

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      transparentOverlay={props.transparentOverlay}
      initialFocusEl={inputRef}
    >
      <Dialog.Content
        forceMount
        data-testid="command-palette"
        class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
        style={{
          height: "24rem",
          // Firefox workaround: bg-surface-1 utility intermittently fails
          // to apply to Corvu-portalled dialog content, leaving it
          // transparent. Inline style guarantees the background paints.
          "background-color": "var(--color-surface-1)",
        }}
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
          class="w-full px-4 py-3 bg-surface-1 text-fg text-sm border-b border-edge outline-none placeholder-fg-3"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div
          class="flex-1 min-h-0 overflow-y-auto"
          onMouseMove={() => (mouseActive = true)}
        >
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
                    ref={(el) => {
                      // Auto-scroll selected item into view during keyboard navigation
                      createEffect(() => {
                        if (selectedIndex() === i())
                          el.scrollIntoView({ block: "nearest" });
                      });
                    }}
                    class="flex items-center px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2"
                    classList={{
                      "bg-surface-3 text-fg border-accent":
                        selectedIndex() === i(),
                      "text-fg-2 hover:bg-surface-2 border-transparent":
                        selectedIndex() !== i(),
                    }}
                    data-selected={selectedIndex() === i() || undefined}
                    onMouseEnter={() => mouseActive && setSelectedIndex(i())}
                    onClick={() => execute(cmd)}
                  >
                    <span class="truncate">
                      {cmd.name}
                      <Show when={cmd.description}>
                        <span class="ml-2 text-fg-3 text-xs">
                          {cmd.description}
                        </span>
                      </Show>
                    </span>
                    <Show when={isGroup(cmd)}>
                      <span class="ml-auto shrink-0 pl-4 text-xs text-fg-3">
                        →
                      </span>
                    </Show>
                    <Show when={!isGroup(cmd) && cmd.keybind}>
                      <span class="ml-auto shrink-0 pl-4 flex items-center gap-1.5">
                        <For
                          each={
                            Array.isArray(cmd.keybind)
                              ? cmd.keybind
                              : [cmd.keybind!]
                          }
                        >
                          {(kb) => <Kbd>{formatKeybind(kb)}</Kbd>}
                        </For>
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={hintsAtLevel().length > 0}>
            <ul class="py-1">
              <For each={hintsAtLevel()}>
                {(hint) => (
                  <li
                    data-testid="palette-hint"
                    class="px-4 py-2 text-xs text-fg-3 italic"
                  >
                    {hint.text}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <Show when={ambientTip()}>
          <div
            data-testid="palette-tip"
            class="px-4 py-2 text-xs text-fg-3 border-t border-edge truncate"
          >
            💡 {ambientTip()}
          </div>
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default CommandPalette;
