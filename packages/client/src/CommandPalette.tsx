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

import Dialog from "@corvu-next/dialog";
import { makeEventListener } from "@solid-primitives/event-listener";
import { encodeHostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";
import { createKeySelector } from "./createKeySelector";
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

/** The sections that keep their own header while a query is typed — the
 *  Conductor's works are places to go, not commands to run, so searching
 *  for one must not file it under "Commands". */
const OWN_HEADER_WHILE_SEARCHING: ReadonlySet<SectionId> = new Set([
  "needs-you",
  "works",
]);

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

/** Annotated render list — root section headers, Terminals host headers
 *  (auto-expanded), or a plain row list. Headers are not selectable;
 *  `index` on rows indexes into `filtered()`. */
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

/** A render entry paired with the identity the list retains its node by. */
export interface KeyedDisplayEntry {
  key: string;
  entry: DisplayEntry;
}

/** The identity an entry WANTS — its logical name in the tree.
 *
 *  Deliberately not unique on its own: a terminal has an id and a host has an
 *  encoded key, but a plain command row has only what it is displayed as, and
 *  two rows can honestly carry the same name. {@link keyDisplayEntries} is what
 *  turns this into a usable key. */
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
  /** The drill PATH — the segments the user drilled into, derived from the
   *  OPEN EDGE and trimmed to what the live command tree still resolves. A
   *  WRITABLE MEMO, not a plain signal: the path FOLLOWS `props.open` and the
   *  tree (the palette closes, a host disconnects, a group hides, and the dead
   *  tail goes) while drill-in and drill-out still write it.
   *
   *  Deriving is what keeps the path out of an effect. An effect that reset it
   *  on `props.open` would RELAY the open: everything reading both the open and
   *  the path (the default-highlight rule, the level memo, the breadcrumb) runs
   *  once in the flush where `open` changed — against the STALE path — and
   *  again after the effect's write lands, so every open paints one torn frame.
   *  As a derivation the new path arrives in the SAME flush as the open.
   *
   *  So an open edge is where a deep link resolves (exactly, against the tree
   *  as it stands at the open), and a close edge is where the path empties.
   *  `open` and `link` ride along as the edge's memory: the derivation sees
   *  only `prev`, and these are what tell a NEW open or a NEW deep link from a
   *  tree tick while the palette stays open.
   *
   *  `dropped` rides along so the imperative half (the departed segments'
   *  `onCancel`) knows what went away: the live-tree trim hands it to the
   *  effect below, the close edge hands it to the open/close lifecycle — which
   *  alone knows whether the close completed a selection and so must NOT
   *  cancel. A drill write clears it: a drill-out cancels what it pops itself.
   *  The derivation returns `prev` UNCHANGED when nothing was trimmed, so a
   *  tree that churns without dropping a segment notifies nobody.
   *
   *  `resolveLivePath` and `resolveInitialPath` are hoisted below — the
   *  derivation runs on read, never at this line. */
  type PathState = {
    /** `props.open` as of the derivation that produced this state. */
    readonly open: boolean;
    /** `props.initialPath`, joined, as of the last resolution. */
    readonly link: string;
    readonly segments: DrillableKind[];
    readonly dropped: readonly DrillableKind[];
  };
  const NO_SEGMENTS: readonly DrillableKind[] = [];
  const NO_PATH: PathState = {
    open: false,
    link: "",
    segments: [],
    dropped: [],
  };
  /** `props.initialPath` as one comparable value — the deep link's identity. */
  const linkKey = (): string => props.initialPath?.join("\0") ?? "";
  const [pathState, setPathState] = createSignal<PathState>(
    (prev = NO_PATH): PathState => {
      const open = props.open;
      const link = linkKey();
      // Closed: no drill path. What it abandons travels as `dropped`, for the
      // lifecycle effect to cancel.
      if (!open)
        return prev.open
          ? { open: false, link, segments: [], dropped: prev.segments }
          : prev;
      // The open edge — and a NEW deep link handed in while it stays open: the
      // path IS the resolved link. Exact resolution only, no prefix fallback (a
      // missing host must not open the broader Terminals list as if the
      // deep-link succeeded); a rejected link leaves the root list showing.
      if (!prev.open || link !== prev.link)
        return {
          open: true,
          link,
          segments: resolveInitialPath(props.initialPath ?? []) ?? [],
          dropped: [],
        };
      const { valid } = resolveLivePath(prev.segments);
      if (valid.length === prev.segments.length) return prev;
      return {
        ...prev,
        segments: valid,
        dropped: prev.segments.slice(valid.length),
      };
    },
  );
  const path = (): DrillableKind[] => pathState().segments;
  const setPath = (
    next: DrillableKind[] | ((prev: DrillableKind[]) => DrillableKind[]),
  ): void => {
    setPathState((prev) => ({
      ...prev,
      segments: typeof next === "function" ? next(prev.segments) : next,
      dropped: [],
    }));
  };

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
          (item.id ?? item.name) === (segment.id ?? segment.name),
      );
      if (!match) break;
      valid.push(match);
      level = resolveChildren(match);
    }
    return { valid, level };
  }

  /** The TRIM's imperative half: a segment the live tree dropped (host
   *  disconnect, group hidden) has its `onCancel` run, and the query that
   *  filtered inside it goes with it. The popping itself is the derivation
   *  above — nothing here writes the path.
   *
   *  A trim of an OPEN palette only: a close drops its segments too, and those
   *  belong to the open/close lifecycle below, which alone knows whether the
   *  close completed a selection. */
  createEffect(
    () => {
      const state = pathState();
      return state.open ? state.dropped : NO_SEGMENTS;
    },
    (dropped) => {
      if (dropped.length === 0) return;
      for (const g of dropped) g.onCancel?.();
      setQuery("");
    },
  );

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

  /** The query AS A FILTER — `""` throughout value mode, where the input holds
   *  a value the user is composing rather than a narrowing term. Named once so
   *  the default-highlight effect can key on "did the filter move?" directly,
   *  instead of re-deriving that distinction from a positional comparison of
   *  its own dependency tuple. */
  const filterQuery = createMemo(() =>
    mode().kind === "filter" ? query() : "",
  );

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

  /** Where the user already is. Read by the empty-root Recent exclusion below
   *  and by the default-highlight rule under it, which are the same idea
   *  (never offer "go where you already are") applied at two levels — so both
   *  take this one value rather than two shapes of it. The host key comes off
   *  `encActiveHost`, the ONE memo every surface that keys on the active host
   *  reads, not a re-derived `encodeHostKey(activeHost())` thunk. */
  const currentSelection = (): CurrentSelection => ({
    hostKey: encActiveHost(),
    terminalId: view.activeId(),
  });

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
    // No `atRoot ?` gate on `current`: the ranker already returns early for a
    // drilled-in level, so re-stating that condition here would only teach the
    // call site the callee's own gating.
    return filterAndRankPaletteItems(stamped, {
      query: q,
      atRoot,
      current: currentSelection(),
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

  /** Kind tags only during typed cross-kind root search — empty-root
   *  section headers (Recent / Hosts / …) already announce kind. */
  const showKindTag = createMemo(
    () => atRootFilter() && query().trim().length > 0,
  );

  /** Map a row to its display section at root. Empty root: terminals →
   *  Recent, hosts → Hosts, commands keep their registered section.
   *  Queried root: kind umbrellas (Terminals / Hosts / Commands), except the
   *  Conductor's works, which keep their own. */
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

  /** The render list paired with the identity `<For keyed>` retains nodes by.
   *
   *  `keyedDisplay` is what the list actually iterates, never `displayed()`.
   *  Solid 2's keyed `mapArray` does NOT drop a repeated key — it indexes the
   *  new window by key and chains the earlier occurrences
   *  (`newIndices` / `newIndicesNext`, @solidjs/signals 2.0.4 `dist/dev.js`
   *  :3537-3560), so same-key entries are paired with old nodes in occurrence
   *  order and every entry still gets a node. What it cannot do is tell two
   *  same-key rows apart: pairing by occurrence means a reorder moves a row's
   *  node (its pending click, its hover) to whichever twin now sits in that
   *  slot. `entryKey` can only fall back to a display name, and names are not
   *  unique (two agents with one command, two rows a repo root does not
   *  separate), so uniqueness has to be established over the whole list rather
   *  than hoped for per item.
   */
  const keyedDisplay = createMemo(() => keyDisplayEntries(displayed()));

  function drillInto(cmd: DrillableKind) {
    setPath((p) => [...p, cmd]);
    if (cmd.kind === "value") setQuery(cmd.prefill());
    else setQuery("");
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
    requestAnimationFrame(() => inputRef.focus());
  }

  /** Resolve `names` against the live command tree — the read half. **Every**
   *  segment must resolve — a partial match (e.g. Terminals without a
   *  missing host) is rejected so deep-links never silently widen; `null` then. */
  function resolveInitialPath(
    names: readonly string[],
  ): DrillableKind[] | null {
    if (names.length === 0) return null;
    let level: PaletteItem[] = props.commands();
    const built: DrillableKind[] = [];
    for (const name of names) {
      const match = level.find(
        (item): item is DrillableKind =>
          isDrillable(item) && item.name === name,
      );
      if (!match) return null;
      built.push(match);
      level = resolveChildren(match);
    }
    return built;
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
        // Ignore Enter while modifier keys are held — the chord that opened
        // the palette (e.g. Cmd+Shift+Enter) would otherwise auto-repeat
        // and immediately confirm the first item.
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

  // Capture phase: intercept before terminal's keydown handler
  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  // Open/close lifecycle — the IMPERATIVE half of an edge: the focus, the
  // one-shot ambient tip, and the cancellation of what a close abandoned. The
  // path itself is derived (see `pathState`), so nothing here writes it and no
  // reader of `props.open` sees a stale path first.
  createEffect(
    () => {
      const isOpen = props.open;
      // The path this edge SETTLED at. Read untracked — a drill while the
      // palette stays open must not re-run the edge — and read AFTER
      // `props.open`, so the derivation has already resolved the deep link
      // (open) or emptied the path (close) for this very flush.
      const settled = untrack(pathState);
      return {
        isOpen,
        // A dep, so a NEW initialPath while the palette stays open re-runs this
        // — the derivation re-resolved it; this half takes the focus.
        link: linkKey(),
        segments: settled.segments,
        // On a close, the segments the emptied path abandoned.
        abandoned: settled.dropped,
        // Snapshots, deliberately NOT dependencies: a peeked ambient tip (a
        // random pick that must not re-roll on every tree tick), and the close
        // branch's other fact (whether the close completed a selection).
        ambientTip: untrack(peekAmbientTipText),
        closedBySelection: untrack(closingForSelection),
      };
    },
    ({ isOpen, segments, abandoned, ambientTip, closedBySelection }) => {
      if (isOpen) {
        setQuery("");
        setAmbientTip(ambientTip);
        setMouseActive(false);
        lastPointerPos = null;
        setClosingForSelection(false);
        const leaf = segments.at(-1);
        if (leaf) {
          // A resolved deep link is the sole focus owner — the double-rAF
          // below would race this one, and for a value-kind leaf its
          // unconditional .focus() would clobber .select().
          requestAnimationFrame(() =>
            leaf.kind === "value" ? inputRef.select() : inputRef.focus(),
          );
        } else {
          // forceMount keeps the dialog in the DOM, so Corvu's initialFocusEl
          // only fires on first mount. Re-focus explicitly on every root open —
          // a rejected deep link included, since that lands on the root list.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => inputRef.focus()),
          );
        }
      } else {
        if (!closedBySelection) {
          for (const g of abandoned) g.onCancel?.();
        }
        // Always clear leaf highlight lifecycle (theme preview, etc.) —
        // path onCancel only covers drill segments.
        lastHighlight?.onCancel?.();
        lastHighlight = undefined;
        setClosingForSelection(false);
      }
    },
  );

  // THE default-highlight rule, applied reactively: whenever the SCOPE changes
  // (open, drill-in, drill-out, path repair, deep-link, typed query) the list is
  // freshly painted and the highlight re-lands. One rule, zero call sites — a
  // future `setPath` cannot forget to follow it up, and the index is derived in
  // one place rather than by read-after-write ordering at eight hand-held sites.
  //
  // The open/close lifecycle effect above no longer writes the path — the
  // derivation settles it, deep link included, in the flush `open` changed —
  // so this rule reads the FINAL path whichever order the two run in.
  //
  // `currentSelection` is a COMPUTE dep, not just an effect-phase read: the
  // "current" row CAN move while the palette stays open — Ctrl+Tab reaches the
  // global dispatcher as well as this component, and the host-membership
  // reconcile can bounce the canvas to local on its own. Both re-derive
  // `filtered()` (the Recent band drops a different row), so a highlight left
  // behind would point at a row that shifted under it, and Enter would run the
  // wrong one. Tracking the fact re-lands the highlight instead.
  //
  // Still NOT keyed on `filtered` itself — that returns a new array reference on
  // every recomputation, so tracking it would reset the index whenever upstream
  // data (the commands memo) recomputes in the background. `filtered`, `query`
  // and `mode` are therefore read in the compute as `untrack` SNAPSHOTS: the
  // index is computed from the list as it stands when a scope change lands,
  // without making their own churn a trigger.
  createEffect(
    () => {
      path();
      filterQuery();
      const open = props.open;
      const selection = currentSelection();
      // A value leaf's children are passive labels, not a switcher: nothing
      // there has a recency or a "current" row, so the highlight starts at the
      // top. Keying on `filterQuery` (which is "" throughout value mode) is
      // what keeps a keystroke from re-landing it off the label you picked,
      // while a SCOPE change still does.
      const index = untrack(() =>
        mode().kind === "value"
          ? 0
          : defaultSelectionIndex(filtered(), selection, query()),
      );
      return { open, index };
    },
    ({ open, index }) => {
      if (!open) return;
      setSelectedIndex(index);
    },
  );

  const effectiveIndex = createMemo(() =>
    Math.max(0, Math.min(selectedIndex(), filtered().length - 1)),
  );
  // Per-key projection (Solid 2's selector): moving the highlight wakes the
  // row it left and the row it reached, not the whole list.
  const isSelected = createKeySelector(effectiveIndex);

  // Notify highlighted item when selection changes. Cancels the previous
  // leaf's onCancel first so root-flattened previews (theme) don't stick.
  // Tracks props.open so the effect re-fires on reopen with the same selection.
  let lastHighlight: (PaletteCommand | PaletteLabel) | undefined;
  createEffect(
    () => [filtered(), effectiveIndex(), props.open] as const,
    ([items, idx, open]) => {
      if (!open) return;
      const next = items[idx];
      if (next === lastHighlight) {
        next?.onHighlight?.();
        return;
      }
      lastHighlight?.onCancel?.();
      lastHighlight = next;
      next?.onHighlight?.();
    },
  );

  // Auto-scroll the highlighted row into view. One effect outside <For>:
  // the per-row JSX sets data-selected on the matching row; this effect
  // queries it. Tracks `selectedIndex` and `props.open`, which together cover
  // every way a fresh list lands its highlight (the effect above) — including
  // an open whose default row is not the first one — so there is no need to
  // re-scroll on `filtered()` reference churn.
  createEffect(
    () => {
      effectiveIndex();
      return props.open;
    },
    (open) => {
      if (!open) return;
      listEl
        ?.querySelector<HTMLElement>("[data-selected]")
        ?.scrollIntoView({ block: "nearest" });
    },
  );

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
            {/* The chips are POSITIONAL — chip n is path depth n, and a drill
                that swaps the group at a depth relabels that chip rather than
                replacing it. `breadcrumbSegments` rebuilds its objects on every
                recomputation, so identity keying would dispose and recreate the
                whole strip for labels that did not move; index keying updates
                them in place. */}
            <For each={breadcrumbSegments()} keyed={false}>
              {(segment, i) => (
                <>
                  <span class="text-fg-3/50">›</span>
                  <button
                    type="button"
                    class={[
                      "px-1.5 py-0.5 rounded-md hover:bg-surface-2/70 transition-colors",
                      {
                        "text-accent font-medium":
                          i() === breadcrumbSegments().length - 1,
                        "hover:text-fg":
                          i() !== breadcrumbSegments().length - 1,
                      },
                    ]}
                    onClick={() => navigateTo(segment().depth)}
                  >
                    {segment().name}
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
            class={[
              "flex-1 min-w-0 bg-transparent text-fg text-base outline-none placeholder-fg-3/80",
              { "text-danger": !!valueError() },
            ]}
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
              {/* A refresh between mouse-down and mouse-up must not remove
                  the node that owns the pending click. Key by logical identity;
                  read the current entry for updated content and callbacks. */}
              <For each={keyedDisplay()} keyed={(keyed) => keyed.key}>
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
