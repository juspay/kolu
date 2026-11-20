import Dialog from "@corvu/dialog";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Key } from "@solid-primitives/keyed";
import { encodeHostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createSelector,
  For,
  on,
  Show,
} from "solid-js";
import { match } from "ts-pattern";
import { hostHue, hostLabel } from "./host/hostChipTone";
import { ACTIONS } from "./input/actions";
import type { Keybind } from "./input/keyboard";
import CreateIdentityPreview from "./palette/CreateIdentityPreview";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import PaletteRow, { type PaletteRowMeta } from "./palette/PaletteRow";
import { notePointerMove, type PointerPos } from "./palette/pointerHoverGate";
import {
  type CurrentSelection,
  defaultSelectionIndex,
  filterAndRankPaletteItems,
  itemKind,
  type ResultKind,
} from "./palette/rootIndex";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { useTips } from "./settings/useTips";
import Kbd from "./ui/Kbd";
import ModalDialog from "./ui/ModalDialog";
import RepoMonogram from "./ui/RepoMonogram";
import { useViewState } from "./useViewState";
import { encActiveHost } from "./wire";

export type SectionId =
  | "recent"
  | "hosts"
  | "needs-you"
  | "works"
  | "commands"
  | "terminals"
  | "active-terminal"
  | "canvas"
  | "ui"
  | "help";

const SECTION_ORDER: readonly SectionId[] = [
  "recent",
  "terminals",
  "hosts",
  "needs-you",
  "works",
  "commands",
  "active-terminal",
  "canvas",
  "ui",
  "help",
];

const SECTION_LABELS: Record<SectionId, string> = {
  recent: "Recent",
  hosts: "Hosts",
  "needs-you": "Needs you",
  works: "Works",
  commands: "Commands",
  terminals: "Terminals",
  "active-terminal": "Active Terminal",
  canvas: "Canvas",
  ui: "UI",
  help: "Help",
};

const OWN_HEADER_WHILE_SEARCHING: ReadonlySet<SectionId> = new Set([
  "needs-you",
  "works",
]);

const SECTION_INDEX: Record<SectionId, number> = Object.fromEntries(
  SECTION_ORDER.map((s, i) => [s, i]),
) as Record<SectionId, number>;

function sectionIndex(s: SectionId | undefined): number {
  return s === undefined ? SECTION_ORDER.length : SECTION_INDEX[s];
}

export type DisplayEntry =
  | { kind: "header"; section: SectionId; index?: never }
  | {
      kind: "host-header";
      name: string;
      count: number;
      group: PaletteGroup;
      index?: never;
    }
  | { kind: "row"; cmd: PaletteCommand | PaletteLabel; index: number };

export interface KeyedDisplayEntry {
  key: string;
  entry: DisplayEntry;
}

function entryKey(entry: DisplayEntry): string {
  return JSON.stringify(
    match(entry)
      .with({ kind: "header" }, (e) => [e.kind, e.section])
      .with({ kind: "host-header" }, (e) => [
        e.kind,
        e.group.row?.hostKey ? encodeHostKey(e.group.row.hostKey) : e.name,
      ])
      .with({ kind: "row" }, (e) => [
        e.kind,
        e.cmd.kind,
        e.cmd.row?.hostKey ? encodeHostKey(e.cmd.row.hostKey) : null,
        e.cmd.row?.terminalId ?? e.cmd.id ?? e.cmd.name,
      ])
      .exhaustive(),
  );
}

/** Pair each entry with a key that is unique ACROSS THE LIST.
 *
 *  A repeated {@link entryKey} gets an occurrence ordinal appended, so entries
 *  the tree cannot tell apart are separated by the only thing that does tell
 *  them apart: where they sit among their twins. Rows with a genuine identity
 *  (a terminal id, a host key, a repo root) never collide, so they keep the
 *  same key across a refresh AND across reordering — which is what lets a node
 *  survive a live update with a click pending on it.
 *
 *  This is not a de-duplication: every entry is still painted. It is the list
 *  saying which of two same-named rows is which. */
export function keyDisplayEntries(
  entries: readonly DisplayEntry[],
): KeyedDisplayEntry[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = entryKey(entry);
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    return { key: nth === 0 ? base : `${base}#${nth}`, entry };
  });
}

/** Fields shared by every interactive palette item. */
interface PaletteBase {
  /** Stable identity when display names are not unique (e.g. repository roots). */
  id?: string;
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
  /** When true, the group is omitted from the empty-root interactive list
   *  (its children may already be promoted as root leaves) but remains
   *  addressable for `openGroup` / `initialPath` resolution. */
  rootHidden?: boolean;
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

function resolveChildren(cmd: PaletteGroup | PaletteValueInput): PaletteItem[] {
  return typeof cmd.children === "function" ? cmd.children() : cmd.children;
}

const CTRL_KEY_MAP: Record<string, string> = { n: "ArrowDown", p: "ArrowUp" };

const CommandPalette: Component<{
  commands: Accessor<PaletteItem[]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Group names to auto-drill on open (e.g. `["Terminals"]` or
   *  `["Terminals", "zest"]`). Tracked reactively — updating while open
   *  re-targets the path. */
  initialPath?: readonly string[];
  /** When true, the backdrop is transparent so content behind is visible. */
  transparentOverlay?: boolean;
}> = (props) => {
  const { peekAmbientTipText } = useTips();
  const view = useViewState();
  let inputRef!: HTMLInputElement;
  let listEl!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [ambientTip, setAmbientTip] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mouseActive, setMouseActive] = createSignal(false);
  let lastPointerPos: PointerPos | null = null;
  const [path, setPath] = createSignal<DrillableKind[]>([]);

  function resolveLivePath(p: DrillableKind[]): {
    valid: DrillableKind[];
    level: PaletteItem[];
  } {
    let level: PaletteItem[] = props.commands();
    const valid: DrillableKind[] = [];
    for (const segment of p) {
      const match = level.find(
        (item): item is PaletteGroup | PaletteValueInput =>
          (item.kind === "group" || item.kind === "value") &&
          (item.id ?? item.name) === (segment.id ?? segment.name),
      );
      if (!match) break;
      valid.push(match);
      level = resolveChildren(match);
    }
    return { valid, level };
  }

  createEffect(() => {
    if (!props.open) return;
    const p = path();
    if (p.length === 0) return;
    const { valid } = resolveLivePath(p);
    if (valid.length === p.length) return;
    for (const g of p.slice(valid.length)) g.onCancel?.();
    setPath(valid);
    setQuery("");
  });

  const currentItems = createMemo((): PaletteItem[] => {
    const p = path();
    if (p.length === 0) return props.commands();
    const { valid, level } = resolveLivePath(p);
    if (valid.length === 0) return props.commands();
    if (valid.length < p.length)
      return resolveChildren(valid[valid.length - 1]!);
    return level;
  });

  const partitioned = createMemo(() => {
    const items = currentItems();
    const hideRootHidden = path().length === 0 && query().trim().length === 0;
    const interactive: (PaletteCommand | PaletteLabel)[] = [];
    const hints: PaletteHint[] = [];
    for (const item of items) {
      if (item.kind === "hint") hints.push(item);
      else if (hideRootHidden && item.kind === "group" && item.rootHidden)
        continue;
      else interactive.push(item);
    }
    return { interactive, hints };
  });

  const mode = createMemo<PaletteMode>(() => {
    const last = path().at(-1);
    if (last?.kind === "value") return { kind: "value", leaf: last };
    return { kind: "filter" };
  });

  const filterQuery = createMemo(() =>
    mode().kind === "filter" ? query() : "",
  );

  const valueError = createMemo<string | null>(() => {
    const m = mode();
    if (m.kind !== "value") return null;
    return m.leaf.validate?.(query()) ?? null;
  });

  function placeholder(): string {
    const m = mode();
    if (m.kind === "value") return m.leaf.placeholder ?? "Type a command...";
    const p = path();
    const last = p.at(-1);
    if (last?.name === TERMINALS_GROUP_NAME) return "Type a terminal…";
    if (p.length >= 2 && p[0]?.name === TERMINALS_GROUP_NAME)
      return "Filter terminals…";
    if (last?.name === HOSTS_GROUP_NAME) return "Filter hosts…";
    if (p.length === 0) return `${ACTIONS.commandPalette.label}…`;
    return "Type a command...";
  }

  const atTerminalsBrowse = createMemo(
    () => path().length === 1 && path()[0]?.name === TERMINALS_GROUP_NAME,
  );
  const atTerminalsBrowseEmpty = createMemo(
    () => atTerminalsBrowse() && query().trim().length === 0,
  );

  function terminalsHostGroups(): PaletteGroup[] {
    return partitioned().interactive.filter(
      (item): item is PaletteGroup =>
        item.kind === "group" && item.row?.kind === "host",
    );
  }

  function flattenHostGroupTerminals(
    items: readonly (PaletteCommand | PaletteLabel)[],
  ): (PaletteCommand | PaletteLabel)[] {
    const out: (PaletteCommand | PaletteLabel)[] = [];
    for (const item of items) {
      if (item.kind !== "group" || item.row?.kind !== "host") continue;
      for (const child of resolveChildren(item)) {
        if (child.kind === "hint") continue;
        if (child.kind === "action" || child.kind === "label") out.push(child);
      }
    }
    return out;
  }

  function flattenForRootSearch(
    items: readonly (PaletteCommand | PaletteLabel)[],
  ): (PaletteCommand | PaletteLabel)[] {
    const out: (PaletteCommand | PaletteLabel)[] = [];
    const collectActions = (list: readonly PaletteItem[]) => {
      for (const item of list) {
        if (item.kind === "action") out.push(item);
        else if (item.kind === "group") collectActions(resolveChildren(item));
      }
    };
    for (const item of items) {
      if (item.kind === "label") continue;
      if (item.kind === "action") {
        out.push(item);
        continue;
      }
      out.push(item);
      if (item.kind !== "group") continue;
      if (
        item.name === TERMINALS_GROUP_NAME ||
        item.name === HOSTS_GROUP_NAME
      ) {
        continue;
      }
      collectActions(resolveChildren(item));
    }
    return out;
  }

  const currentSelection = (): CurrentSelection => ({
    hostKey: encActiveHost(),
    terminalId: view.activeId(),
  });

  const filtered = createMemo((): (PaletteCommand | PaletteLabel)[] => {
    let items = partitioned().interactive;
    if (mode().kind !== "filter") {
      return [...items].sort(
        (a, b) => sectionIndex(a.section) - sectionIndex(b.section),
      );
    }
    const p = path();
    const q = query();
    const atRoot = p.length === 0;
    if (atTerminalsBrowse()) {
      items = flattenHostGroupTerminals(items);
    } else if (atRoot && q.trim().length > 0) {
      items = flattenForRootSearch(items);
    }
    const stamped = items.map((cmd, i) => ({
      ...cmd,
      sectionOrder: sectionIndex(cmd.section) * 1000 + i,
    }));
    return filterAndRankPaletteItems(stamped, {
      query: q,
      atRoot,
      current: currentSelection(),
    });
  });

  const breadcrumbSegments = createMemo(
    (): { name: string; depth: number }[] => {
      const segments = path().map((s, i) => ({ name: s.name, depth: i + 1 }));
      const p = path();
      if (
        p.length === 1 &&
        p[0]?.name === TERMINALS_GROUP_NAME &&
        query().trim().length > 0
      ) {
        const sel = filtered()[effectiveIndex()];
        const host = sel?.row?.hostKey;
        if (host) {
          segments.push({ name: hostLabel(host), depth: segments.length + 1 });
        }
      }
      return segments;
    },
  );

  const atRootFilter = createMemo(
    () => path().length === 0 && mode().kind === "filter",
  );

  const showSectionHeaders = createMemo(() => atRootFilter());

  const showKindTag = createMemo(
    () => atRootFilter() && query().trim().length > 0,
  );

  function displaySection(
    cmd: PaletteCommand | PaletteLabel,
  ): SectionId | undefined {
    if (!atRootFilter()) return cmd.section;
    const kind: ResultKind = itemKind(cmd);
    const hasQuery = query().trim().length > 0;
    if (kind === "terminal") return hasQuery ? "terminals" : "recent";
    if (kind === "host") return "hosts";
    if (
      hasQuery &&
      !(
        cmd.section !== undefined && OWN_HEADER_WHILE_SEARCHING.has(cmd.section)
      )
    )
      return "commands";
    return cmd.section;
  }

  const displayed = createMemo((): DisplayEntry[] => {
    if (atTerminalsBrowseEmpty()) {
      const out: DisplayEntry[] = [];
      let index = 0;
      for (const group of terminalsHostGroups()) {
        const kids = resolveChildren(group).filter(
          (c): c is PaletteCommand | PaletteLabel => c.kind !== "hint",
        );
        out.push({
          kind: "host-header",
          name: group.name,
          count: kids.length,
          group,
        });
        for (const child of kids) {
          out.push({ kind: "row", cmd: child, index: index++ });
        }
      }
      return out;
    }

    const items = filtered();
    if (!showSectionHeaders()) {
      return items.map((cmd, index) => ({ kind: "row" as const, cmd, index }));
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

  const hasListContent = createMemo(() => displayed().length > 0);

  const keyedDisplay = createMemo(() => keyDisplayEntries(displayed()));

  function drillInto(cmd: DrillableKind) {
    setPath((p) => [...p, cmd]);
    if (cmd.kind === "value") setQuery(cmd.prefill());
    else setQuery("");
    requestAnimationFrame(() =>
      cmd.kind === "value" ? inputRef.select() : inputRef.focus(),
    );
  }

  function navigateTo(depth: number) {
    const p = path();
    if (
      depth === p.length + 1 &&
      p.length === 1 &&
      p[0]?.name === TERMINALS_GROUP_NAME
    ) {
      const hostName = breadcrumbSegments().at(-1)?.name;
      if (hostName) drillIntoHostUnderTerminals(hostName);
      return;
    }
    for (const g of p.slice(depth)) g.onCancel?.();
    setPath(p.slice(0, depth));
    setQuery("");
  }

  function drillIntoHostUnderTerminals(hostName: string) {
    const terminals = props
      .commands()
      .find(
        (c): c is PaletteGroup =>
          c.kind === "group" && c.name === TERMINALS_GROUP_NAME,
      );
    if (!terminals) return;
    const hostGroup = resolveChildren(terminals).find(
      (c): c is PaletteGroup => c.kind === "group" && c.name === hostName,
    );
    if (!hostGroup) return;
    setPath([terminals, hostGroup]);
    setQuery("");
    requestAnimationFrame(() => inputRef.focus());
  }

  function applyInitialPath(names: readonly string[]) {
    if (names.length === 0) return false;
    let level: PaletteItem[] = props.commands();
    const built: DrillableKind[] = [];
    for (const name of names) {
      const match = level.find(
        (item): item is DrillableKind =>
          isDrillable(item) && item.name === name,
      );
      if (!match) return false;
      built.push(match);
      level = resolveChildren(match);
    }
    setPath(built);
    setQuery("");
    const leaf = built.at(-1);
    requestAnimationFrame(() =>
      leaf?.kind === "value" ? inputRef.select() : inputRef.focus(),
    );
    return true;
  }

  const [closingForSelection, setClosingForSelection] = createSignal(false);

  function closeForSelection() {
    setClosingForSelection(true);
    props.onOpenChange(false);
  }

  function execute(cmd: PaletteCommand | PaletteLabel) {
    const m = mode();
    if (m.kind === "value") {
      if (cmd.kind !== "label") return;
      if (valueError()) return;
      closeForSelection();
      m.leaf.onSubmit(query(), cmd);
      return;
    }
    match(cmd)
      .with({ kind: "group" }, { kind: "value" }, (group) => drillInto(group))
      .with({ kind: "action" }, (action) => {
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
        setMouseActive(false);
        setSelectedIndex(Math.min(effectiveIndex() + 1, items.length - 1));
        break;
      case "ArrowUp":
        if (items.length === 0) return;
        setMouseActive(false);
        setSelectedIndex(Math.max(effectiveIndex() - 1, 0));
        break;
      case "Tab":
        if (items.length === 0) return;
        setMouseActive(false);
        setSelectedIndex(
          e.shiftKey
            ? (effectiveIndex() - 1 + items.length) % items.length
            : (effectiveIndex() + 1) % items.length,
        );
        break;
      case "Backspace":
        if (query() === "" && path().length > 0) {
          navigateTo(path().length - 1);
          break;
        }
        return;
      case "Enter": {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const selected = items[effectiveIndex()];
        if (selected) execute(selected);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  createEffect(
    on(
      [() => props.open, () => props.initialPath?.join("\0") ?? ""],
      ([isOpen, pathKey]) => {
        if (isOpen) {
          setQuery("");
          setAmbientTip(peekAmbientTipText());
          setMouseActive(false);
          lastPointerPos = null;
          setClosingForSelection(false);
          setPath([]);
          const names = props.initialPath ?? [];
          if (names.length > 0) {
            if (!applyInitialPath(names)) {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => inputRef.focus()),
              );
            }
          } else {
            // forceMount keeps the dialog in the DOM, so Corvu's initialFocusEl
            // only fires on first mount. Re-focus explicitly on every root open.
            // When a path is set, applyInitialPath is the sole focus owner —
            // its rAF would otherwise race this double-rAF, and for a value-kind
            // leaf the unconditional .focus() would clobber .select().
            requestAnimationFrame(() =>
              requestAnimationFrame(() => inputRef.focus()),
            );
          }
          void pathKey;
        } else {
          if (!closingForSelection()) {
            for (const g of path()) g.onCancel?.();
          }
          lastHighlight?.onCancel?.();
          lastHighlight = undefined;
          setClosingForSelection(false);
          setPath([]);
        }
      },
    ),
  );

  createEffect(
    on(
      [path, filterQuery, () => props.open, currentSelection],
      ([, , open]) => {
        if (!open) return;
        if (mode().kind === "value") {
          setSelectedIndex(0);
          return;
        }
        setSelectedIndex(
          defaultSelectionIndex(filtered(), currentSelection(), query()),
        );
      },
    ),
  );

  const effectiveIndex = createMemo(() =>
    Math.max(0, Math.min(selectedIndex(), filtered().length - 1)),
  );
  const isSelected = createSelector(effectiveIndex);

  let lastHighlight: (PaletteCommand | PaletteLabel) | undefined;
  createEffect(
    on([filtered, effectiveIndex, () => props.open], ([items, idx, open]) => {
      if (!open) return;
      const next = items[idx];
      if (next === lastHighlight) {
        next?.onHighlight?.();
        return;
      }
      lastHighlight?.onCancel?.();
      lastHighlight = next;
      next?.onHighlight?.();
    }),
  );

  createEffect(() => {
    effectiveIndex();
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
      size="palette"
    >
      <Dialog.Content
        forceMount
        data-testid="command-palette"
        class="w-full border border-edge rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/[0.03] overflow-hidden flex flex-col"
        style={{
          height: "min(80vh, 40rem)",
          // Subtle vertical gradient from surface-1 → surface-0 gives the
          // chrome a soft depth without theming it. The inline style also
          // works around a Firefox quirk where the `bg-surface-1` utility
          // intermittently failed to apply on Corvu-portalled content.
          background:
            "linear-gradient(180deg, var(--color-surface-1) 0%, var(--color-surface-0) 100%)",
        }}
      >
        <Show when={breadcrumbSegments().length > 0}>
          <nav class="flex items-center gap-1.5 px-5 pt-3.5 text-xs text-fg-3">
            <button
              type="button"
              class="px-1.5 py-0.5 rounded-md hover:text-fg hover:bg-surface-2/70 transition-colors"
              onClick={() => navigateTo(0)}
            >
              Commands
            </button>
            <For each={breadcrumbSegments()}>
              {(segment, i) => (
                <>
                  <span class="text-fg-3/50">›</span>
                  <button
                    type="button"
                    class="px-1.5 py-0.5 rounded-md hover:bg-surface-2/70 transition-colors"
                    classList={{
                      "text-accent font-medium":
                        i() === breadcrumbSegments().length - 1,
                      "hover:text-fg": i() !== breadcrumbSegments().length - 1,
                    }}
                    onClick={() => navigateTo(segment.depth)}
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
            el.addEventListener(
              "mousemove",
              (e: MouseEvent) => {
                const { hoverArmed, pos } = notePointerMove(lastPointerPos, {
                  x: e.clientX,
                  y: e.clientY,
                });
                lastPointerPos = pos;
                if (hoverArmed) setMouseActive(true);
              },
              { passive: true },
            );
          }}
          class="flex-1 min-h-0 overflow-y-auto"
        >
          <Show
            when={hasListContent()}
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
              <Key each={keyedDisplay()} by={(keyed) => keyed.key}>
                {(keyed) => {
                  const entry = () => keyed().entry;
                  const header = () => {
                    const e = entry();
                    return e.kind === "header" ? e : undefined;
                  };
                  const host = () => {
                    const e = entry();
                    return e.kind === "host-header" ? e : undefined;
                  };
                  const row = () => {
                    const e = entry();
                    return e.kind === "row" ? e : undefined;
                  };
                  return (
                    <>
                      <Show when={header()}>
                        {(header) => (
                          <div
                            data-testid="palette-section-header"
                            data-section={header().section}
                            class="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[0.64rem] font-semibold tracking-[0.14em] uppercase text-fg-3/80 select-none first:pt-1"
                          >
                            {SECTION_LABELS[header().section]}
                          </div>
                        )}
                      </Show>
                      <Show when={host()}>
                        {(host) => (
                          <button
                            type="button"
                            data-testid="palette-host-header"
                            data-host-name={host().name}
                            data-count={host().count}
                            class="palette-host-header first:pt-1"
                            style={
                              host().group.row?.hostKey
                                ? {
                                    "--host-hue": hostHue(
                                      host().group.row!.hostKey!,
                                    ),
                                  }
                                : undefined
                            }
                            title={`Show only ${host().name}`}
                            onClick={() => drillInto(host().group)}
                          >
                            <Show when={host().group.row?.hostKey}>
                              <RepoMonogram
                                group={host().name}
                                color={hostHue(host().group.row!.hostKey!)}
                                size="xs"
                                data-testid="palette-host-monogram"
                              />
                            </Show>
                            <span class="truncate">{host().name}</span>
                            <span class="ml-auto font-mono font-normal tracking-normal normal-case opacity-70">
                              {host().count === 1
                                ? "1 terminal"
                                : `${host().count} terminals`}
                            </span>
                          </button>
                        )}
                      </Show>
                      <Show when={row()}>
                        {(row) => (
                          <PaletteRow
                            cmd={row().cmd}
                            selected={isSelected(row().index)}
                            query={query()}
                            showKindTag={showKindTag()}
                            drillable={isDrillable(row().cmd)}
                            onHover={() =>
                              mouseActive() && setSelectedIndex(row().index)
                            }
                            onSelect={() => execute(row().cmd)}
                          />
                        )}
                      </Show>
                    </>
                  );
                }}
              </Key>
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
        <CreateIdentityPreview
          path={path()}
          mode={mode()}
          query={query()}
          highlighted={filtered()[effectiveIndex()]}
        />
        <ActionBar
          mode={mode()}
          drilled={path().length > 0}
          highlighted={filtered()[effectiveIndex()]}
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
