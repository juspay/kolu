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
import { match } from "ts-pattern";
import type { Keybind } from "./input/keyboard";
import PaletteRow, { type PaletteRowMeta } from "./palette/PaletteRow";
import {
  filterAndRankPaletteItems,
  itemKind,
  type ResultKind,
} from "./palette/rootIndex";
import { useTips } from "./settings/useTips";
import Kbd from "./ui/Kbd";
import ModalDialog from "./ui/ModalDialog";

/** Top-level sections, in render order. Items tagged with a section are
 *  grouped under a sticky header at the root level; untagged items
 *  render without a header. Drill-in levels ignore sections entirely
 *  (children of a group all belong to that group).
 *
 *  `recent` / `hosts` / `commands` support the unified root index — Recent
 *  workspaces on empty root, host rows, and the cross-kind Commands umbrella
 *  while searching. */
export type SectionId =
  | "recent"
  | "hosts"
  | "commands"
  | "workspaces"
  | "active-terminal"
  | "canvas"
  | "ui"
  | "help";

const SECTION_ORDER: readonly SectionId[] = [
  "recent",
  "workspaces",
  "hosts",
  "commands",
  "active-terminal",
  "canvas",
  "ui",
  "help",
];

const SECTION_LABELS: Record<SectionId, string> = {
  recent: "Recent",
  hosts: "Hosts",
  commands: "Commands",
  workspaces: "Terminals",
  "active-terminal": "Active Terminal",
  canvas: "Canvas",
  ui: "UI",
  help: "Help",
};

/** O(1) lookup derived from `SECTION_ORDER` — single source of truth.
 *  Built at module load via `Object.fromEntries(...)` so reordering
 *  `SECTION_ORDER` automatically rebuilds the map; there is no parallel
 *  literal to keep in sync. */
const SECTION_INDEX: Record<SectionId, number> = Object.fromEntries(
  SECTION_ORDER.map((s, i) => [s, i]),
) as Record<SectionId, number>;

/** Stable sort key: tagged items cluster in canonical order; untagged
 *  items sort to the end and preserve their registration order via the
 *  stability of `Array.prototype.sort`. */
function sectionIndex(s: SectionId | undefined): number {
  return s === undefined ? SECTION_ORDER.length : SECTION_INDEX[s];
}

/** Fields shared by every interactive palette item. */
interface PaletteBase {
  name: string;
  /** Secondary text shown after the name, de-emphasized. */
  description?: string;
  /** Opaque payload — palette never interprets `data`; it just hands it
   *  back via `onSubmit` so callers can identify the chosen option
   *  without string-matching on `name`. */
  data?: unknown;
  /** Optional leading icon — rendered before `name`. The palette stays
   *  agnostic: callers pass the component, the palette renders it. */
  icon?: Component<{ class?: string }>;
  /** Keyboard shortcut(s) to display alongside the command name. */
  keybind?: Keybind | Keybind[];
  /** Top-level grouping — only rendered at the root level. Untagged
   *  items appear with no header. Ignored for drill-in children. */
  section?: SectionId;
  /** Rich-row presentation for the unified root index (workspace / host /
   *  command). Commands may omit it and paint as kind `"command"`. */
  row?: PaletteRowMeta;
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

/** Top-level commands — action, group, or value-input.
 *  Labels are not permitted at the top level; they appear only as
 *  `PaletteValueInput` children. */
export type PaletteCommand = PaletteAction | PaletteGroup | PaletteValueInput;

/** Anything renderable at a palette level. */
export type PaletteItem = PaletteCommand | PaletteLabel | PaletteHint;

/** Any drillable kind — group with children, or value input. */
type DrillableKind = PaletteGroup | PaletteValueInput;

/** Discriminated UI mode driven by the deepest path segment. Filter
 *  mode: input narrows the children list. Value mode: input is a
 *  free-text field; children render as passive labels. Exported so
 *  child components (e.g. ActionBar) reference the same union the
 *  engine dispatches on — a future arm forces both ends to update. */
export type PaletteMode =
  | { kind: "filter" }
  | { kind: "value"; leaf: PaletteValueInput };

function isDrillable(item: PaletteItem): item is DrillableKind {
  return item.kind === "group" || item.kind === "value";
}

/** Resolve children, handling both static arrays and accessors. Body
 *  groups have no children, so they are excluded from the input type —
 *  callers narrow first. */
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
  const { peekAmbientTipText } = useTips();
  let inputRef!: HTMLInputElement;
  let listEl!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [ambientTip, setAmbientTip] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // Ignore mouseEnter until a real mouse move after opening (prevents cursor-under-palette hijack).
  const [mouseActive, setMouseActive] = createSignal(false);
  const [path, setPath] = createSignal<DrillableKind[]>([]);

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
          (item.kind === "group" || item.kind === "value") &&
          item.name === segment.name,
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

  const mode = createMemo<PaletteMode>(() => {
    const last = path().at(-1);
    if (last?.kind === "value") return { kind: "value", leaf: last };
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
    const last = path().at(-1);
    if (last?.name === "Search terminals") return "Filter terminals…";
    if (last?.name === "Switch host") return "Filter hosts…";
    if (path().length === 0) return "Search everything…";
    return "Type a command...";
  }

  /** Interactive rows at the current level (filter is bypassed in
   *  value mode). Filter mode produces `PaletteCommand[]`;
   *  value mode produces `PaletteLabel[]`.
   *
   *  AND-token multi-field match — the same matcher the dock uses
   *  (`matchesAllTokens` / `tokenize`), so typing a branch or host
   *  name at root finds it. Root ranks terminals → hosts → commands
   *  (recency within workspaces; recent-cap on empty root). */
  const filtered = createMemo((): (PaletteCommand | PaletteLabel)[] => {
    const items = partitioned().interactive;
    if (mode().kind !== "filter") {
      // Value mode doesn't search — preserve registration order with a
      // stable section sort for any tagged labels.
      return [...items].sort(
        (a, b) => sectionIndex(a.section) - sectionIndex(b.section),
      );
    }
    const atRoot = path().length === 0;
    // Stamp sectionOrder so the pure ranker can re-sort commands without
    // knowing SectionId.
    const stamped = items.map((cmd, i) => ({
      ...cmd,
      sectionOrder: sectionIndex(cmd.section) * 1000 + i,
    }));
    return filterAndRankPaletteItems(stamped, {
      query: query(),
      atRoot,
    });
  });

  /** Annotated render list — interleaves section headers with rows when
   *  at root. Headers do not participate in selection; `index` on row
   *  entries still indexes into `filtered()` directly so keyboard
   *  navigation stays unchanged. */
  type DisplayEntry =
    | { kind: "header"; section: SectionId; index?: never }
    | { kind: "row"; cmd: PaletteCommand | PaletteLabel; index: number };

  const atRootFilter = createMemo(
    () => path().length === 0 && mode().kind === "filter",
  );

  const showSectionHeaders = createMemo(() => atRootFilter());

  /** Kind tags only during cross-kind root search (empty or queried). */
  const showKindTag = createMemo(() => atRootFilter());

  /** Map a row to its display section at root. Empty root: workspaces →
   *  Recent, hosts → Hosts, commands keep their registered section.
   *  Queried root: kind umbrellas (Workspaces / Hosts / Commands). */
  function displaySection(
    cmd: PaletteCommand | PaletteLabel,
  ): SectionId | undefined {
    if (!atRootFilter()) return cmd.section;
    const kind: ResultKind = itemKind(cmd);
    const hasQuery = query().trim().length > 0;
    if (kind === "terminal") return hasQuery ? "workspaces" : "recent";
    if (kind === "host") return "hosts";
    if (hasQuery) return "commands";
    return cmd.section;
  }

  const displayed = createMemo((): DisplayEntry[] => {
    const items = filtered();
    if (!showSectionHeaders()) {
      return items.map((cmd, index) => ({ kind: "row", cmd, index }));
    }
    const out: DisplayEntry[] = [];
    let lastSection: SectionId | undefined;
    items.forEach((cmd, index) => {
      const section = displaySection(cmd);
      if (section !== undefined && section !== lastSection) {
        out.push({ kind: "header", section });
      }
      lastSection = section;
      out.push({ kind: "row", cmd, index });
    });
    return out;
  });

  function drillInto(cmd: DrillableKind) {
    setPath((p) => [...p, cmd]);
    if (cmd.kind === "value") setQuery(cmd.prefill());
    else setQuery("");
    setSelectedIndex(0);
    // Drill-ins always re-focus the input — Enter / click on a drillable
    // row may have left focus on the row's div (click steals focus from
    // the input, Enter on a div option doesn't restore it), so the user
    // can immediately type to filter the sub-mode. Deferred to rAF so the
    // input has rendered any new query value first (select() before the
    // render highlights nothing). One rAF suffices here because the dialog
    // is already open and Corvu's initialFocusEl is idle — no focus
    // competition. The open-effect uses a double-rAF to outlast Corvu's
    // own focus management on (re)open.
    requestAnimationFrame(() =>
      cmd.kind === "value" ? inputRef.select() : inputRef.focus(),
    );
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

  // Open/close lifecycle — one effect so the read of `path()` for
  // `onCancel` propagation is ordered explicitly before the path
  // reset. Splitting open-vs-initialGroup into two `on()` effects
  // raced when both depended on `props.open` (the path-reset effect
  // could fire first, clearing the segments the close branch was
  // about to walk for cancellation).
  createEffect(
    on([() => props.open, () => props.initialGroup], ([isOpen, initial]) => {
      if (isOpen) {
        setQuery("");
        setSelectedIndex(0);
        setAmbientTip(peekAmbientTipText());
        setMouseActive(false);
        setClosingForSelection(false);
        setPath([]);
        if (initial) {
          const group = props
            .commands()
            .find(
              (c): c is DrillableKind => isDrillable(c) && c.name === initial,
            );
          if (group) drillInto(group);
        } else {
          // forceMount keeps the dialog in the DOM, so Corvu's initialFocusEl
          // only fires on first mount. Re-focus explicitly on every root open.
          // When `initial` is set, `drillInto()` is the sole focus owner — its
          // rAF would otherwise race this double-rAF, and for a value-kind
          // initial group the unconditional .focus() would clobber the
          // .select() drillInto() scheduled.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => inputRef.focus()),
          );
        }
      } else {
        if (!closingForSelection()) {
          for (const g of path()) g.onCancel?.();
        }
        setClosingForSelection(false);
        setPath([]);
      }
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
      // No `refocusOnClose`: the palette also closes itself programmatically
      // (selection → onOpenChange(false), Cmd+K → toggle()), paths that never
      // re-enter ModalDialog.handleOpenChange. So the refocus lives once in
      // `useCommandPalette`'s close path, which EVERY close (incl. the
      // Corvu-driven onOpenChange this dialog forwards) funnels through —
      // adding `refocusOnClose` here would double-fire it on the Corvu path.
      size="lg"
    >
      <Dialog.Content
        forceMount
        data-testid="command-palette"
        class="w-full border border-edge rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/[0.03] overflow-hidden flex flex-col"
        style={{
          // Cap at 80vh so the dialog adapts to the workspace grid's
          // four-column body without forcing scroll for small dialogs;
          // 40rem keeps the chrome compact on tall monitors.
          height: "min(80vh, 40rem)",
          // Subtle vertical gradient from surface-1 → surface-0 gives the
          // chrome a soft depth without theming it. The inline style also
          // works around a Firefox quirk where the `bg-surface-1` utility
          // intermittently failed to apply on Corvu-portalled content.
          background:
            "linear-gradient(180deg, var(--color-surface-1) 0%, var(--color-surface-0) 100%)",
        }}
      >
        {/* Breadcrumb — visible when drilled into a group. Renders as
            Raycast-style chips: "Commands › Theme" feels like a path you
            can click any segment of to pop back. */}
        <Show when={path().length > 0}>
          <nav class="flex items-center gap-1.5 px-5 pt-3.5 text-xs text-fg-3">
            <button
              type="button"
              class="px-1.5 py-0.5 rounded-md hover:text-fg hover:bg-surface-2/70 transition-colors"
              onClick={() => navigateTo(0)}
            >
              Commands
            </button>
            <For each={path()}>
              {(segment, i) => (
                <>
                  <span class="text-fg-3/50">›</span>
                  <button
                    type="button"
                    class="px-1.5 py-0.5 rounded-md hover:bg-surface-2/70 transition-colors"
                    classList={{
                      "text-accent font-medium": i() === path().length - 1,
                      "hover:text-fg": i() !== path().length - 1,
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
        <div class="flex items-center gap-3 px-5 py-3.5 border-b border-edge/60">
          <span
            aria-hidden="true"
            class="font-mono text-base leading-none text-accent select-none"
          >
            ⏵
          </span>
          <input
            ref={inputRef}
            type="text"
            data-value-input={mode().kind === "value" ? "" : undefined}
            data-value-invalid={valueError() ? "" : undefined}
            placeholder={placeholder()}
            class="flex-1 min-w-0 bg-transparent text-fg text-base outline-none placeholder-fg-3/80"
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
              class="px-5 py-2 text-xs text-danger border-b border-edge/60 bg-danger/[0.06]"
            >
              {msg()}
            </div>
          )}
        </Show>
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
              <div class="flex flex-col items-center justify-center gap-1 px-5 py-10 text-center">
                <span
                  aria-hidden="true"
                  class="font-mono text-base text-fg-3/60 select-none"
                >
                  ⏵
                </span>
                <span class="text-sm text-fg-2">No matches</span>
                <span class="text-xs text-fg-3/70">Try a different search</span>
              </div>
            }
          >
            <div class="py-1 px-1.5" role="listbox">
              <For each={displayed()}>
                {(entry) =>
                  entry.kind === "header" ? (
                    <div
                      data-testid="palette-section-header"
                      data-section={entry.section}
                      class="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[0.64rem] font-semibold tracking-[0.14em] uppercase text-fg-3/80 select-none first:pt-1"
                    >
                      {SECTION_LABELS[entry.section]}
                    </div>
                  ) : (
                    <PaletteRow
                      cmd={entry.cmd}
                      selected={selectedIndex() === entry.index}
                      query={query()}
                      showKindTag={showKindTag()}
                      drillable={isDrillable(entry.cmd)}
                      onHover={() =>
                        mouseActive() && setSelectedIndex(entry.index)
                      }
                      onSelect={() => execute(entry.cmd)}
                    />
                  )
                }
              </For>
            </div>
          </Show>
          <Show when={partitioned().hints.length > 0}>
            <ul class="py-1 px-2">
              <For each={partitioned().hints}>
                {(hint) => (
                  <li
                    data-testid="palette-hint"
                    class="px-3 py-2 text-xs text-fg-3/80 italic"
                  >
                    {hint.text}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <ActionBar
          mode={mode()}
          drilled={path().length > 0}
          highlighted={filtered()[selectedIndex()]}
        />
        <Show when={ambientTip()}>
          <div
            data-testid="palette-tip"
            class="flex items-center gap-2 px-5 py-2 text-xs text-fg-3/80 border-t border-edge/60 bg-surface-0/40 truncate"
          >
            <span
              aria-hidden="true"
              class="shrink-0 w-1 h-1 rounded-full bg-accent/70"
            />
            <span class="truncate">{ambientTip()}</span>
          </div>
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

/** Bottom action bar — Raycast-style hint strip showing what `⏎` will
 *  do for the currently highlighted row, plus an `esc Back` affordance
 *  when the path is drilled. Border-top separates it from the scrollable
 *  list above; the ambient tip (when present) renders below this bar. */
const ActionBar: Component<{
  mode: PaletteMode;
  drilled: boolean;
  highlighted: PaletteCommand | PaletteLabel | undefined;
}> = (props) => {
  function primaryLabel(): string {
    return match(props.mode)
      .with({ kind: "value" }, () => "Submit")
      .with({ kind: "filter" }, () => {
        const h = props.highlighted;
        if (!h) return "";
        if (isDrillable(h)) return "Open";
        // Terminal / host root rows switch context; plain commands run.
        if (h.row?.kind === "terminal" || h.row?.kind === "host")
          return "Switch";
        return "Run";
      })
      .exhaustive();
  }
  return (
    <div
      data-testid="palette-action-bar"
      class="flex items-center justify-between gap-3 px-5 py-2 border-t border-edge/60 text-[0.7rem] text-fg-3"
    >
      <Show when={primaryLabel()}>
        {(label) => (
          <span class="flex items-center gap-1.5">
            <Kbd>⏎</Kbd>
            <span class="text-fg-2 font-medium">{label()}</span>
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
