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
import { Dynamic } from "solid-js/web";
import { match } from "ts-pattern";
import { formatKeybind, type Keybind } from "./input/keyboard";
import { matchesAllTokens, tokenize } from "./search";
import { useTips } from "./settings/useTips";
import Kbd from "./ui/Kbd";
import ModalDialog from "./ui/ModalDialog";

/** Fields shared by every interactive palette item. */
interface PaletteBase {
  name: string;
  /** Secondary text shown after the name, de-emphasized. */
  description?: string;
  /** Extra searchable text that is **not** rendered. Used by rich rows
   *  (e.g. workspace entries) whose human-readable description is a
   *  short summary but whose search corpus is much wider — repo paths,
   *  PR titles, agent metadata, etc. The filter checks `name`,
   *  `description`, and `searchText` together with AND-token semantics. */
  searchText?: string;
  /** Short right-aligned source classifier — "Command", "Workspace",
   *  "Theme", "Group", etc. Renders as a muted chip after the keybind /
   *  group-arrow slot, mirroring Raycast's per-row type label. Pure
   *  decoration; the filter does NOT match against it. */
  typeLabel?: string;
  /** Opaque payload — palette never interprets `data`; it just hands it
   *  back via `onSubmit` so callers can identify the chosen option
   *  without string-matching on `name`. */
  data?: unknown;
  /** Optional leading icon — rendered before `name`. The palette stays
   *  agnostic: callers pass the component, the palette renders it. */
  icon?: Component<{ class?: string }>;
  /** Keyboard shortcut(s) to display alongside the command name. */
  keybind?: Keybind | Keybind[];
  /** Called when this item becomes the highlighted item during navigation. */
  onHighlight?: () => void;
  /** Called when leaving this item without executing it (Escape, Backspace, breadcrumb). */
  onCancel?: () => void;
}

/** A leaf that runs an action when selected. */
export interface PaletteAction extends PaletteBase {
  kind: "action";
  onSelect: () => void;
}

/** A nested level. Drilling in narrows navigation to its children. */
export interface PaletteGroup extends PaletteBase {
  kind: "group";
  /** Static array or accessor for dynamic lists. */
  children: PaletteItem[] | (() => PaletteItem[]);
  /** Optional custom body — when present, replaces the default
   *  filtered-list rendering after drill-in. The group still owns
   *  search-input behaviour (palette forwards the typed query) and
   *  the breadcrumb / bottom action bar, but the body decides how to
   *  paint its rows. Use this for grids that don't fit a single
   *  column of items (e.g. agent-state columns + facet sidebar). */
  body?: Component<{ query: string; closePalette: () => void }>;
  /** Hint string shown in the bottom action bar when the body is
   *  active — describes what clicking inside the body does (e.g.
   *  "Click a workspace to switch"). Ignored when no body is set. */
  bodyHint?: string;
}

/** A group whose drill-in switches the input from a filter to a free-text
 *  value field — pre-filled with `prefill()` and auto-selected on focus.
 *  Children are passive label rows: their own `onSelect` (if any) is
 *  bypassed and Enter (or click) routes through this group's `onSubmit`
 *  with the typed value plus the highlighted label. Up/Down still moves
 *  the highlight; Backspace on an empty value drills back out.
 *
 *  Children are restricted to labels and hints — the type rules out
 *  actions or nested groups, so the "labels live inside value groups"
 *  invariant is enforced at compile time. `onSubmit` receives the
 *  highlighted child narrowed to `PaletteLabel`.
 *
 *  `validate` runs on every keystroke; returning a non-null message
 *  paints the input red, renders the message under the input, and
 *  blocks submit until the value passes again. */
export interface PaletteValueInput extends PaletteBase {
  kind: "value";
  prefill: () => string;
  placeholder?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string, selected: PaletteLabel) => void;
  /** Static array or accessor for dynamic lists. */
  children:
    | (PaletteLabel | PaletteHint)[]
    | (() => (PaletteLabel | PaletteHint)[]);
}

/** A passive selectable row inside a `PaletteValueInput`'s children —
 *  rendered like an action but has no `onSelect` of its own; the value
 *  group's `onSubmit` receives it as the highlighted choice. */
export interface PaletteLabel extends PaletteBase {
  kind: "label";
}

/** A non-interactive informational row shown inside a palette group. */
export interface PaletteHint {
  kind: "hint";
  text: string;
}

/** Top-level commands — action, group, or value-input. Labels are not
 *  permitted at the top level; they appear only as `PaletteValueInput`
 *  children. */
export type PaletteCommand = PaletteAction | PaletteGroup | PaletteValueInput;

/** Anything renderable at a palette level. */
export type PaletteItem = PaletteCommand | PaletteLabel | PaletteHint;

function isGroup(item: PaletteItem): item is PaletteGroup | PaletteValueInput {
  return item.kind === "group" || item.kind === "value";
}

/** Resolve children, handling both static arrays and accessors.
 *  `PaletteValueChild` is a subset of `PaletteItem`, so a value-group's
 *  children fit the wider return type. */
function resolveChildren(cmd: PaletteGroup | PaletteValueInput): PaletteItem[] {
  return typeof cmd.children === "function" ? cmd.children() : cmd.children;
}

/** Ctrl+key → normalized key for readline-style navigation. */
const CTRL_KEY_MAP: Record<string, string> = { n: "ArrowDown", p: "ArrowUp" };

const CommandPalette: Component<{
  commands: Accessor<PaletteItem[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If set, auto-drill into the group with this name on open. Tracked
   *  reactively — a caller updating the prop while open re-targets the
   *  drilled level. */
  initialGroup?: string;
  /** When true, the backdrop is transparent so content behind is visible. */
  transparentOverlay?: boolean;
}> = (props) => {
  const { randomAmbientTip } = useTips();
  let inputRef!: HTMLInputElement;
  let listEl!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [ambientTip, setAmbientTip] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // Ignore mouseEnter until a real mouse move after opening (prevents cursor-under-palette hijack).
  const [mouseActive, setMouseActive] = createSignal(false);
  const [path, setPath] = createSignal<(PaletteGroup | PaletteValueInput)[]>(
    [],
  );

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
    const last = p.at(-1);
    if (last === undefined) return props.commands();
    let level: PaletteItem[] = props.commands();
    for (const segment of p) {
      const match = level.find(
        (item): item is PaletteGroup | PaletteValueInput =>
          isGroup(item) && item.name === segment.name,
      );
      if (!match) return resolveChildren(last);
      level = resolveChildren(match);
    }
    return level;
  });

  /** Single-pass partition of `currentItems()` into interactive rows
   *  (commands or labels) and hints — one traversal feeds both consumers
   *  (the list and the hint footer). */
  const partitioned = createMemo(() => {
    const items = currentItems();
    const interactive: (PaletteCommand | PaletteLabel)[] = [];
    const hints: PaletteHint[] = [];
    for (const item of items) {
      if (item.kind === "hint") hints.push(item);
      else interactive.push(item);
    }
    return { interactive, hints };
  });

  /** Discriminated UI mode driven by the deepest path segment.
   *  Filter mode: input narrows the children list. Value mode: input is
   *  a free-text field; children render as passive labels. Body mode:
   *  the group renders its own custom JSX in place of the list (the
   *  input still drives a query the body reads). The behavior swaps
   *  (filter bypass, validation, placeholder, key dispatch, render
   *  branch) all switch on this. */
  type Mode =
    | { kind: "filter" }
    | { kind: "value"; leaf: PaletteValueInput }
    | { kind: "body"; leaf: PaletteGroup };

  const mode = createMemo<Mode>(() => {
    const last = path().at(-1);
    if (last?.kind === "value") return { kind: "value", leaf: last };
    if (last?.kind === "group" && last.body)
      return { kind: "body", leaf: last };
    return { kind: "filter" };
  });

  /** Validation error for the current value-input query. `null` outside
   *  value mode or when the value passes. */
  const valueError = createMemo<string | null>(() => {
    const m = mode();
    if (m.kind !== "value") return null;
    return m.leaf.validate?.(query()) ?? null;
  });

  /** Input placeholder, derived from mode. Plain function — single
   *  consumer (the input element). */
  function placeholder(): string {
    const m = mode();
    if (m.kind === "value") return m.leaf.placeholder ?? "Type a command...";
    return "Type a command...";
  }

  /** Interactive rows at the current level (filter is bypassed in
   *  value and body modes). Filter mode produces `PaletteCommand[]`;
   *  value mode produces `PaletteLabel[]`; body mode skips the list
   *  entirely. The union covers all three without dynamic typing.
   *
   *  AND-token semantics: the query is split on whitespace; every token
   *  must appear in at least one of `name`, `description`, or `searchText`
   *  (the latter is invisible — rich rows like workspace entries use it
   *  to carry their full 20-field corpus). */
  const filtered = createMemo((): (PaletteCommand | PaletteLabel)[] => {
    const items = partitioned().interactive;
    if (mode().kind !== "filter") return items;
    const tokens = tokenize(query());
    if (tokens.length === 0) return items;
    return items.filter((cmd) => {
      const haystack = `${cmd.name} ${cmd.description ?? ""} ${cmd.searchText ?? ""}`;
      return matchesAllTokens(haystack, tokens);
    });
  });

  // Reserve a leading icon gutter for the whole list when ANY row carries
  // an icon, so rows with and without icons stay aligned. Driven by the
  // unfiltered command tree, not the typed-query subset, so the gutter
  // doesn't appear/disappear as the user types.
  const hasAnyIcon = createMemo(() =>
    partitioned().interactive.some((cmd) => cmd.icon),
  );

  function drillInto(cmd: PaletteGroup | PaletteValueInput) {
    setPath((p) => [...p, cmd]);
    if (cmd.kind === "value") {
      setQuery(cmd.prefill());
      // Defer select() to rAF so the input has rendered the new value
      // first — selecting before the render highlights nothing.
      requestAnimationFrame(() => inputRef.select());
    } else {
      setQuery("");
    }
    setSelectedIndex(0);
  }

  function navigateTo(depth: number) {
    const p = path();
    for (const g of p.slice(depth)) g.onCancel?.();
    setPath(p.slice(0, depth));
    setQuery("");
    setSelectedIndex(0);
  }

  // Selection-initiated close: signals the close-effect to skip
  // path.onCancel propagation. External closes (Escape, backdrop click,
  // parent toggle via setPaletteOpen) leave this false so onCancel fires.
  // Three close paths converge on the close-effect; this signal is the
  // single discriminator that distinguishes "completed" from "cancelled".
  const [closingForSelection, setClosingForSelection] = createSignal(false);

  function closeForSelection() {
    setClosingForSelection(true);
    props.onOpenChange(false);
  }

  function execute(cmd: PaletteCommand | PaletteLabel) {
    const m = mode();
    if (m.kind === "value") {
      // Structural invariant: value-input children are PaletteLabel —
      // anything else here is a caller bug.
      if (cmd.kind !== "label") return;
      // Block submit while the typed value is invalid; the inline error
      // row already tells the user what to fix.
      if (valueError()) return;
      closeForSelection();
      m.leaf.onSubmit(query(), cmd);
      return;
    }
    // Filter mode — labels never appear at the top level (enforced by
    // PaletteValueChild only being reachable inside a value group).
    // .exhaustive() forces a compile error if a future kind is added
    // without an arm here.
    match(cmd)
      .with({ kind: "group" }, { kind: "value" }, (group) => drillInto(group))
      .with({ kind: "action" }, (action) => {
        // Close first so the highlight effect stops tracking filtered(),
        // preventing onSelect's state changes from re-triggering a preview.
        closeForSelection();
        action.onSelect();
      })
      .with({ kind: "label" }, () => {})
      .exhaustive();
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
        if (query() === "" && path().length > 0) {
          navigateTo(path().length - 1);
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

  // Open: reset transient state. Close: fire onCancel for the drilled-in
  // path unless the close was selection-initiated.
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setQuery("");
          setSelectedIndex(0);
          setAmbientTip(randomAmbientTip());
          setMouseActive(false);
          setClosingForSelection(false);
          // forceMount keeps the dialog in the DOM, so Corvu's initialFocusEl
          // only fires on first mount. Re-focus explicitly on every open.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => inputRef.focus()),
          );
        } else {
          if (!closingForSelection()) {
            for (const g of path()) g.onCancel?.();
          }
          setClosingForSelection(false);
        }
      },
    ),
  );

  // Track initialGroup reactively: a caller changing the prop (or opening
  // with a new value) re-targets the drilled level. Closing clears the path.
  // Routes through `drillInto` rather than `setPath` directly so the
  // value-input branch (prefill + auto-select) fires when initialGroup
  // names a value-input leaf.
  createEffect(
    on([() => props.open, () => props.initialGroup], ([isOpen, initial]) => {
      setPath([]);
      if (!isOpen || !initial) return;
      const group = props
        .commands()
        .find(
          (c): c is PaletteGroup | PaletteValueInput =>
            isGroup(c) && c.name === initial,
        );
      if (group) drillInto(group);
    }),
  );

  // Reset selection when the user types (defer: skip initial run).
  // Intentionally tracks `query`, not `filtered` — filtered returns a new array
  // reference on every recomputation, so tracking it would reset the index whenever
  // upstream data (commands memo) recomputes in the background.
  createEffect(
    on(
      query,
      () => {
        // Skip in value mode: query is a value, not a filter.
        if (mode().kind === "value") return;
        setSelectedIndex(0);
      },
      { defer: true },
    ),
  );

  // Notify highlighted item when selection changes. Tracks props.open so
  // the effect re-fires on reopen with the same selection.
  createEffect(
    on([filtered, selectedIndex, () => props.open], ([items, idx, open]) => {
      if (!open) return;
      items[idx]?.onHighlight?.();
    }),
  );

  // Auto-scroll the highlighted row into view. One effect outside <For>:
  // the per-row JSX sets data-selected on the matching row; this effect
  // queries it. Filter changes already reset selectedIndex to 0 (see the
  // selection-reset effect above), so the top item is structurally in
  // view — no need to re-scroll on `filtered()` changes.
  createEffect(() => {
    selectedIndex();
    if (!props.open) return;
    listEl
      ?.querySelector<HTMLElement>("[data-selected]")
      ?.scrollIntoView({ block: "nearest" });
  });

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
          // Cap at 80vh so the dialog adapts to the workspace grid's
          // four-column body without forcing scroll for small dialogs;
          // 40rem keeps the chrome compact on tall monitors.
          height: "min(80vh, 40rem)",
          width: "min(90vw, 44rem)",
          // Firefox workaround: bg-surface-1 utility intermittently fails
          // to apply to Corvu-portalled dialog content, leaving it
          // transparent. Inline style guarantees the background paints.
          "background-color": "var(--color-surface-1)",
        }}
      >
        {/* Breadcrumb — visible when drilled into a group. Renders as
            Raycast-style chips: "Commands › Theme" feels like a path you
            can click any segment of to pop back. */}
        <Show when={path().length > 0}>
          <nav class="flex items-center gap-1.5 px-4 pt-3 text-xs text-fg-3">
            <button
              type="button"
              class="px-1.5 py-0.5 rounded hover:text-fg hover:bg-surface-2 transition-colors"
              onClick={() => navigateTo(0)}
            >
              Commands
            </button>
            <For each={path()}>
              {(segment, i) => (
                <>
                  <span class="text-fg-3/60">›</span>
                  <button
                    type="button"
                    class="px-1.5 py-0.5 rounded hover:text-fg hover:bg-surface-2 transition-colors"
                    classList={{
                      "text-fg font-medium": i() === path().length - 1,
                    }}
                    onClick={() => navigateTo(i() + 1)}
                  >
                    {segment.name}
                  </button>
                </>
              )}
            </For>
          </nav>
        </Show>
        <div class="flex items-center gap-2 px-4 py-3 border-b border-edge">
          <span
            aria-hidden="true"
            class="font-mono text-[0.85rem] leading-none text-accent select-none"
          >
            ⏵
          </span>
          <input
            ref={inputRef}
            type="text"
            data-value-input={mode().kind === "value" ? "" : undefined}
            data-value-invalid={valueError() ? "" : undefined}
            placeholder={placeholder()}
            class="flex-1 min-w-0 bg-transparent text-fg text-sm outline-none placeholder-fg-3"
            classList={{
              "text-danger": !!valueError(),
            }}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <Show when={valueError()}>
          {(msg) => (
            <div
              data-testid="palette-value-error"
              class="px-4 py-2 text-xs text-danger border-b border-edge"
            >
              {msg()}
            </div>
          )}
        </Show>
        <Show
          when={(() => {
            const m = mode();
            return m.kind === "body" ? m.leaf : undefined;
          })()}
          fallback={
            <div
              ref={(el) => {
                listEl = el;
                // mousemove is incidental UI state, not a real interactive event
                // on this scroll container — attach via addEventListener so the
                // div stays a plain layout element (Biome's
                // noStaticElementInteractions would flag a JSX onMouseMove).
                el.addEventListener("mousemove", () => setMouseActive(true), {
                  passive: true,
                });
              }}
              class="flex-1 min-h-0 overflow-y-auto"
            >
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="px-4 py-3 text-sm text-fg-2">
                    No matching commands
                  </div>
                }
              >
                <div class="py-1" role="listbox">
                  <For each={filtered()}>
                    {(cmd, i) => (
                      <div
                        role="option"
                        tabIndex={-1}
                        aria-selected={selectedIndex() === i()}
                        class="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer transition-colors duration-150 border-l-2"
                        classList={{
                          "bg-surface-3 text-fg border-accent":
                            selectedIndex() === i(),
                          "text-fg-2 hover:bg-surface-2 border-transparent":
                            selectedIndex() !== i(),
                        }}
                        data-selected={selectedIndex() === i() || undefined}
                        onMouseEnter={() =>
                          mouseActive() && setSelectedIndex(i())
                        }
                        onClick={() => execute(cmd)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            execute(cmd);
                          }
                        }}
                      >
                        <Show when={hasAnyIcon()}>
                          <span class="shrink-0 w-3 inline-flex items-center justify-center">
                            <Dynamic component={cmd.icon} class="w-3 h-3" />
                          </span>
                        </Show>
                        <div class="flex-1 min-w-0 flex items-baseline gap-2">
                          <span class="truncate">{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="text-fg-3 text-xs truncate min-w-0">
                              {cmd.description}
                            </span>
                          </Show>
                        </div>
                        <Show when={cmd.kind === "action" && cmd.keybind}>
                          {(keybind) => {
                            const kb = keybind();
                            return (
                              <span class="shrink-0 flex items-center gap-1.5">
                                <For each={Array.isArray(kb) ? kb : [kb]}>
                                  {(k) => <Kbd>{formatKeybind(k)}</Kbd>}
                                </For>
                              </span>
                            );
                          }}
                        </Show>
                        <Show when={isGroup(cmd)}>
                          <span class="shrink-0 text-xs text-fg-3">→</span>
                        </Show>
                        <Show when={cmd.typeLabel}>
                          {(label) => (
                            <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-fg-3/60 w-20 text-right">
                              {label()}
                            </span>
                          )}
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={partitioned().hints.length > 0}>
                <ul class="py-1">
                  <For each={partitioned().hints}>
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
          }
        >
          {(group) => (
            <Dynamic
              component={group().body}
              query={query()}
              closePalette={closeForSelection}
            />
          )}
        </Show>
        <ActionBar
          mode={mode()}
          drilled={path().length > 0}
          highlighted={filtered()[selectedIndex()]}
        />
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

/** Bottom action bar — Raycast-style hint strip showing what `⏎` will
 *  do for the currently highlighted row (or what clicking inside the
 *  body does, in body mode), plus an `esc Back` affordance when the
 *  path is drilled. Border-top separates it from the scrollable list
 *  above; the ambient tip (when present) renders below this bar. */
const ActionBar: Component<{
  mode:
    | { kind: "filter" }
    | { kind: "value"; leaf: PaletteValueInput }
    | { kind: "body"; leaf: PaletteGroup };
  drilled: boolean;
  highlighted: PaletteCommand | PaletteLabel | undefined;
}> = (props) => {
  function primaryLabel(): string {
    if (props.mode.kind === "body") {
      return props.mode.leaf.bodyHint ?? "Pick an item";
    }
    if (props.mode.kind === "value") return "Submit";
    const h = props.highlighted;
    if (!h) return "";
    if (h.kind === "group" || h.kind === "value") return "Open";
    return "Run";
  }
  return (
    <div
      data-testid="palette-action-bar"
      class="flex items-center justify-between gap-3 px-4 py-1.5 border-t border-edge text-[0.7rem] text-fg-3"
    >
      <Show when={primaryLabel()}>
        {(label) => (
          <span class="flex items-center gap-1.5">
            <Kbd>⏎</Kbd>
            <span>{label()}</span>
          </span>
        )}
      </Show>
      <Show when={props.drilled}>
        <span class="flex items-center gap-1.5 ml-auto">
          <Kbd>esc</Kbd>
          <span>Back</span>
        </span>
      </Show>
    </div>
  );
};

export default CommandPalette;
