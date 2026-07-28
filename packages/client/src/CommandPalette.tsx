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
import { encodeHostKey } from "kolu-common/hostKey";
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
import { hostHue, hostLabel } from "./host/hostChipTone";
import { ACTIONS } from "./input/actions";
import type { Keybind } from "./input/keyboard";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import PaletteRow, { type PaletteRowMeta } from "./palette/PaletteRow";
import { notePointerMove, type PointerPos } from "./palette/pointerHoverGate";
import {
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
import { activeHost } from "./wire";

/** Top-level sections, in render order. Items tagged with a section are
 *  grouped under a sticky header at the root level; untagged items
 *  render without a header. Drill-in levels ignore sections entirely
 *  (children of a group all belong to that group).
 *
 *  `recent` / `hosts` / `terminals` / `commands` support the unified root
 *  index — Recent terminals on empty root, host rows, the Terminals section
 *  for fleet navigation, and the Commands umbrella while searching. */
export type SectionId =
  | "recent"
  | "hosts"
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
  terminals: "Terminals",
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
  // Hover selection only after a real pointer delta — see pointerHoverGate.
  // Synthetic mousemove/enter under a stationary cursor must not steal the
  // keyboard highlight (open-under-cursor shimmer).
  const [mouseActive, setMouseActive] = createSignal(false);
  let lastPointerPos: PointerPos | null = null;
  const [path, setPath] = createSignal<DrillableKind[]>([]);

  /** Walk `path` against the live command tree; return the live
   *  drillable segments that still resolve, in order. */
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
          item.name === segment.name,
      );
      if (!match) break;
      valid.push(match);
      level = resolveChildren(match);
    }
    return { valid, level };
  }

  /** If a path segment disappears (host disconnect, group hidden), pop
   *  to the deepest still-valid segment — never keep showing children
   *  from a stale path object. */
  createEffect(() => {
    if (!props.open) return;
    const p = path();
    if (p.length === 0) return;
    const { valid } = resolveLivePath(p);
    if (valid.length === p.length) return;
    for (const g of p.slice(valid.length)) g.onCancel?.();
    setPath(valid);
    setQuery("");
    setSelectedIndex(0);
  });

  /** Items at the current navigation level (may include hints).
   *
   *  Resolves the drilled-in path by **name** against the fresh
   *  `props.commands()` tree, not by object reference against the
   *  snapshot captured in `path()`. */
  const currentItems = createMemo((): PaletteItem[] => {
    const p = path();
    if (p.length === 0) return props.commands();
    const { valid, level } = resolveLivePath(p);
    // While the reconcile effect hasn't trimmed yet, render the deepest
    // still-valid level — never the stale missing segment's children.
    if (valid.length === 0) return props.commands();
    if (valid.length < p.length)
      return resolveChildren(valid[valid.length - 1]!);
    return level;
  });

  /** Single-pass partition of `currentItems()` into interactive rows
   *  (commands or labels) and hints — one traversal feeds both consumers
   *  (the list and the hint footer). */
  const partitioned = createMemo(() => {
    const items = currentItems();
    // Hide rootHidden containers only on empty-root browse (children already
    // promoted). Typed root search still indexes them for name match / drill.
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
  /** Empty Terminals browse — auto-expand host groups into headers + rows. */
  const atTerminalsBrowseEmpty = createMemo(
    () => atTerminalsBrowse() && query().trim().length === 0,
  );

  /** Host groups at the Terminals level (tree children), in paint order. */
  function terminalsHostGroups(): PaletteGroup[] {
    return partitioned().interactive.filter(
      (item): item is PaletteGroup =>
        item.kind === "group" && item.row?.kind === "host",
    );
  }

  /** Flatten host groups → terminal leaves (host order preserved). Used for
   *  selection at Terminals browse — grouping is visual only, not a gate. */
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

  /** Root type-search index: top-level items (including terminal/host
   *  leaves already registered at root) plus nested **command** actions
   *  under Debug / New terminal / etc. Do **not** collect leaves from
   *  Terminals / Hosts groups — those leaves are already top-level and
   *  re-collecting them doubles every fleet hit. */
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
      // Top-level group or value — keep for name match / drillInto.
      out.push(item);
      if (item.kind !== "group") continue;
      // Skip groups whose children are already promoted to root leaves.
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

  /** Interactive rows at the current level (filter is bypassed in
   *  value mode). Filter mode produces `PaletteCommand[]`;
   *  value mode produces `PaletteLabel[]`.
   *
   *  AND-token multi-field match — the same matcher the dock uses
   *  (`matchesAllTokens` / `tokenize`). At Terminals browse the tree is
   *  host groups, but selection always sees a **flat terminal list**
   *  (auto-expanded). At root with a non-empty query, nested command
   *  leaves are included so "Search everything" finds Debug leaves. */
  const filtered = createMemo((): (PaletteCommand | PaletteLabel)[] => {
    let items = partitioned().interactive;
    if (mode().kind !== "filter") {
      // Value mode doesn't search — preserve registration order with a
      // stable section sort for any tagged labels.
      return [...items].sort(
        (a, b) => sectionIndex(a.section) - sectionIndex(b.section),
      );
    }
    const p = path();
    const q = query();
    const atRoot = p.length === 0;
    if (atTerminalsBrowse()) {
      // Always flatten — empty browse and typed filter share one list.
      items = flattenHostGroupTerminals(items);
    } else if (atRoot && q.trim().length > 0) {
      items = flattenForRootSearch(items);
    }
    // Stamp sectionOrder so the pure ranker can re-sort commands without
    // knowing SectionId.
    const stamped = items.map((cmd, i) => ({
      ...cmd,
      sectionOrder: sectionIndex(cmd.section) * 1000 + i,
    }));
    const activeId = view.activeId();
    const excludeFromRecent =
      atRoot && activeId !== null
        ? { hostKey: encodeHostKey(activeHost()), terminalId: activeId }
        : null;
    return filterAndRankPaletteItems(stamped, {
      query: q,
      atRoot,
      excludeFromRecent,
    });
  });

  /** Breadcrumb labels — path names, plus a virtual host segment when a
   *  Terminals search highlight lands on a terminal (so the path reads
   *  Commands › Terminals › zest without a real host drill). */
  const breadcrumbSegments = createMemo(
    (): { name: string; depth: number }[] => {
      const segments = path().map((s, i) => ({ name: s.name, depth: i + 1 }));
      const p = path();
      if (
        p.length === 1 &&
        p[0]?.name === TERMINALS_GROUP_NAME &&
        query().trim().length > 0
      ) {
        const sel = filtered()[selectedIndex()];
        const host = sel?.row?.hostKey;
        if (host) {
          segments.push({ name: hostLabel(host), depth: segments.length + 1 });
        }
      }
      return segments;
    },
  );

  /** Annotated render list — root section headers, Terminals host headers
   *  (auto-expanded), or a plain row list. Headers are not selectable;
   *  `index` on rows indexes into `filtered()`. */
  type DisplayEntry =
    | { kind: "header"; section: SectionId; index?: never }
    | {
        kind: "host-header";
        name: string;
        count: number;
        group: PaletteGroup;
        index?: never;
      }
    | { kind: "row"; cmd: PaletteCommand | PaletteLabel; index: number };

  const atRootFilter = createMemo(
    () => path().length === 0 && mode().kind === "filter",
  );

  const showSectionHeaders = createMemo(() => atRootFilter());

  /** Kind tags only during typed cross-kind root search — empty-root
   *  section headers (Recent / Hosts / …) already announce kind. */
  const showKindTag = createMemo(
    () => atRootFilter() && query().trim().length > 0,
  );

  /** Map a row to its display section at root. Empty root: terminals →
   *  Recent, hosts → Hosts, commands keep their registered section.
   *  Queried root: kind umbrellas (Terminals / Hosts / Commands). */
  function displaySection(
    cmd: PaletteCommand | PaletteLabel,
  ): SectionId | undefined {
    if (!atRootFilter()) return cmd.section;
    const kind: ResultKind = itemKind(cmd);
    const hasQuery = query().trim().length > 0;
    if (kind === "terminal") return hasQuery ? "terminals" : "recent";
    if (kind === "host") return "hosts";
    if (hasQuery) return "commands";
    return cmd.section;
  }

  const displayed = createMemo((): DisplayEntry[] => {
    // Terminals empty browse: host header (name · count) + that host's
    // terminals — visual grouping, no drill required. Clicking a header
    // optionally scopes to that host (breadcrumb Terminals › $host).
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

  /** List has content to paint (rows and/or host headers with zero terms). */
  const hasListContent = createMemo(() => displayed().length > 0);

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
    // Virtual host breadcrumb (pierce search): depth beyond real path drills
    // into that host group under Terminals when possible.
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
    setSelectedIndex(0);
  }

  /** From Terminals browse, drill into a named host group (breadcrumb or
   *  deep-link). Resolves against the live tree so object identity stays fresh. */
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
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.focus());
  }

  /** Walk `names` against the live command tree and set path. **Every**
   *  segment must resolve — a partial match (e.g. Terminals without a
   *  missing host) is rejected so deep-links never silently widen. */
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
    setSelectedIndex(0);
    const leaf = built.at(-1);
    requestAnimationFrame(() =>
      leaf?.kind === "value" ? inputRef.select() : inputRef.focus(),
    );
    return true;
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
        // Keyboard wins until the pointer actually moves again.
        setMouseActive(false);
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        if (items.length === 0) return;
        setMouseActive(false);
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Tab":
        if (items.length === 0) return;
        setMouseActive(false);
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
  // reset. Splitting open-vs-initialPath into two `on()` effects
  // raced when both depended on `props.open` (the path-reset effect
  // could fire first, clearing the segments the close branch was
  // about to walk for cancellation).
  createEffect(
    on(
      [() => props.open, () => props.initialPath?.join("\0") ?? ""],
      ([isOpen, pathKey]) => {
        if (isOpen) {
          setQuery("");
          setSelectedIndex(0);
          setAmbientTip(peekAmbientTipText());
          setMouseActive(false);
          lastPointerPos = null;
          setClosingForSelection(false);
          setPath([]);
          const names = props.initialPath ?? [];
          if (names.length > 0) {
            // Exact path only — no prefix fallback (a missing host must not
            // open the broader Terminals list as if the deep-link succeeded).
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
          // pathKey keeps the effect subscribed to initialPath identity.
          void pathKey;
        } else {
          if (!closingForSelection()) {
            for (const g of path()) g.onCancel?.();
          }
          // Always clear leaf highlight lifecycle (theme preview, etc.) —
          // path onCancel only covers drill segments.
          lastHighlight?.onCancel?.();
          lastHighlight = undefined;
          setClosingForSelection(false);
          setPath([]);
        }
      },
    ),
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

  // Keep selectedIndex in range when the live list shrinks (terminal exit,
  // host disconnect, activity-window age-out) without rebinding on every
  // filtered() reference churn — track length only.
  createEffect(
    on(
      () => filtered().length,
      (len) => {
        if (len === 0) {
          setSelectedIndex(0);
          return;
        }
        if (selectedIndex() >= len) setSelectedIndex(len - 1);
      },
    ),
  );

  // Notify highlighted item when selection changes. Cancels the previous
  // leaf's onCancel first so root-flattened previews (theme) don't stick.
  // Tracks props.open so the effect re-fires on reopen with the same selection.
  let lastHighlight: (PaletteCommand | PaletteLabel) | undefined;
  createEffect(
    on([filtered, selectedIndex, () => props.open], ([items, idx, open]) => {
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
      // Compact switcher width — not the old workspace-grid lg stretch.
      size="palette"
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
            Raycast-style chips: "Commands › Terminals › zest" feels like a
            path you can click any segment of to pop back. A pierced
            Terminals search may append a virtual host segment from the
            highlighted row. */}
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
            // mousemove is incidental UI state, not a real interactive event
            // on this scroll container — attach via addEventListener so the
            // div stays a plain layout element (Biome's
            // noStaticElementInteractions would flag a JSX onMouseMove).
            // Only arm hover after a real coordinate delta (not synthetic
            // zero-delta moves when the list mounts under a stationary cursor).
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
                  ) : entry.kind === "host-header" ? (
                    <button
                      type="button"
                      data-testid="palette-host-header"
                      data-host-name={entry.name}
                      data-count={entry.count}
                      class="palette-host-header first:pt-1"
                      style={
                        entry.group.row?.hostKey
                          ? {
                              "--host-hue": hostHue(entry.group.row.hostKey),
                              // Monogram reuses --repo-color socket.
                              "--repo-color": hostHue(entry.group.row.hostKey),
                            }
                          : undefined
                      }
                      title={`Show only ${entry.name}`}
                      onClick={() => drillInto(entry.group)}
                    >
                      <Show when={entry.group.row?.hostKey}>
                        <RepoMonogram
                          group={entry.name}
                          color={hostHue(entry.group.row!.hostKey!)}
                          size="xs"
                          data-testid="palette-host-monogram"
                        />
                      </Show>
                      <span class="truncate">{entry.name}</span>
                      <span class="ml-auto font-mono font-normal tracking-normal normal-case opacity-70">
                        {entry.count === 1
                          ? "1 terminal"
                          : `${entry.count} terminals`}
                      </span>
                    </button>
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
