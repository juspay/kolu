/** Workspace grid — the column/facet body mounted inside the command
 *  palette when the user drills into "Search workspaces" (#912).
 *
 *  The palette engine owns the search input, breadcrumb, and key
 *  dispatch; this component receives the typed query as a prop and
 *  renders the columns / facet sidebar / cards underneath. Selecting
 *  any card calls `onSelect`, which activates that terminal and
 *  closes the palette.
 *
 *  Reads as an operator's console: typographic hierarchy carries the
 *  load, not boxes-within-boxes. Repo identity (color) appears in the
 *  sidebar's selection bar, the card eyebrow, and the card border —
 *  three echoes of the same truth. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { activeArm, activePr, type TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  Show,
} from "solid-js";
import NotesBody from "../../notes/NotesBody";
import { NotesMarkdownInline } from "../../notes/NotesMarkdown";
import { annotationLine } from "../../notes/text";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import { formatTimeAgo, useIdleClassifier } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";
import { PrStateIcon } from "../../ui/Icons";
import {
  bucketDescriptor,
  buildDockModel,
  type DockColumn,
  type DockEntry,
  type DockSourceEntry,
} from "../dockModel";
import { agentLabel, metaLine, tokenLine } from "./dockRowChrome";
import { StatePip } from "./RowPips";

/** Slot tag on each card. The scroll-into-view effect queries by this
 *  value so the lookup stays scoped to *this* grid instance even if a
 *  second mount point ever lands — declared once so the render-site
 *  attribute and the query selector can't drift. */
const WORKSPACE_GRID_SLOT = "palette-body" as const;

const WorkspaceGrid: Component<{
  /** Live-terminal source rows the grid filters and buckets. */
  entries: DockSourceEntry[];
  /** Per-terminal recency timestamp the grid uses for in-bucket order. */
  getRecency: (id: TerminalId) => number;
  /** Current palette query — drives the AND-token filter. */
  query: string;
  /** Activate the picked terminal and dismiss the palette. */
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const idleClassifier = useIdleClassifier();
  const [repoFilter, setRepoFilter] = createSignal<string | null>(null);
  const model = createMemo(() =>
    buildDockModel(props.entries, {
      query: props.query,
      repoFilter: repoFilter(),
      getRecency: props.getRecency,
      idleClassifier,
    }),
  );
  const columnCount = () => Math.max(1, model().columns.length);
  const totalCount = () =>
    model().repoFacets.reduce((sum, facet) => sum + facet.count, 0);

  // Per-column entry lists — the user sees agent-state columns
  // (Idle, Awaiting, Working, No agent) side by side, so the
  // keyboard cursor tracks `(column, row)` rather than a single
  // linear index. Idle's sub-buckets (4-12h → 48h+) collapse into
  // one flat column for nav purposes; the user just scans top to
  // bottom inside the Idle column.
  const columnEntries = createMemo<DockEntry[][]>(() =>
    model().columns.map((column) => {
      if (column.key === "idle") {
        return column.idleSubBuckets.flatMap((sub) => sub.entries);
      }
      return column.entries;
    }),
  );
  // The keyboard cursor is one logical thing — the id of the
  // highlighted entry. Step* functions locate the id in the column
  // layout, compute the next position, and write back the new id.
  // The reconcile effect falls the id back to the first available
  // entry when the visible set narrows past it. One signal, one
  // truth, no fallback drift.
  const [highlightedId, setHighlightedId] = createSignal<TerminalId | null>(
    null,
  );

  function firstAvailableId(): TerminalId | null {
    for (const col of columnEntries()) {
      if (col.length > 0) return col[0]?.id ?? null;
    }
    return null;
  }

  /** Locate the highlighted id in the column layout. `null` when the
   *  id isn't currently visible (the reconcile effect will move it). */
  function locateHighlight(): { col: number; row: number } | null {
    const id = highlightedId();
    if (id === null) return null;
    const cols = columnEntries();
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      if (!col) continue;
      const row = col.findIndex((e) => e.id === id);
      if (row >= 0) return { col: c, row };
    }
    return null;
  }

  const selectedEntry = createMemo<DockEntry | null>(() => {
    const id = highlightedId();
    if (id === null) return null;
    for (const col of columnEntries()) {
      const entry = col.find((e) => e.id === id);
      if (entry) return entry;
    }
    return null;
  });

  // Reset selection when the visible set changes. Track the id list
  // so metadata-only updates don't perturb the cursor. If the
  // highlighted id is gone (or unset), fall back to the first
  // available entry across all columns.
  createEffect(
    on(
      () =>
        columnEntries()
          .flat()
          .map((e) => e.id),
      () => {
        if (locateHighlight() === null) setHighlightedId(firstAvailableId());
      },
    ),
  );

  function stepRow(delta: 1 | -1) {
    const pos = locateHighlight();
    if (!pos) return;
    const col = columnEntries()[pos.col];
    if (!col) return;
    const nextRow = Math.max(0, Math.min(col.length - 1, pos.row + delta));
    const target = col[nextRow];
    if (target) setHighlightedId(target.id);
  }

  function stepColumn(delta: 1 | -1) {
    const pos = locateHighlight();
    if (!pos) return;
    const cols = columnEntries();
    let c = pos.col + delta;
    while (c >= 0 && c < cols.length) {
      const next = cols[c];
      if (next && next.length > 0) {
        const target = next[Math.min(pos.row, next.length - 1)];
        if (target) setHighlightedId(target.id);
        return;
      }
      c += delta;
    }
    // No non-empty column in that direction — leave the cursor where
    // it is rather than wrapping (wrap would teleport the user across
    // the grid in a way that breaks the spatial mental model).
  }

  function activateSelected() {
    const entry = selectedEntry();
    if (entry) props.onSelect(entry.id);
  }

  makeEventListener(
    window,
    "keydown",
    (e) => {
      // Capture phase: this listener registers after the palette
      // engine's, but the engine bails for nav keys when mode is
      // `body`. Tab is intentionally NOT handled here — the input
      // still owns focus, and Tab inside a text input should keep
      // its default browser behaviour.
      if (e.key === "ArrowDown") {
        stepRow(1);
      } else if (e.key === "ArrowUp") {
        stepRow(-1);
      } else if (e.key === "ArrowRight") {
        stepColumn(1);
      } else if (e.key === "ArrowLeft") {
        stepColumn(-1);
      } else if (e.key === "Enter") {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        activateSelected();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  // Scroll the highlighted card into view as the user navigates.
  // Look up the card by id rather than by index so we don't depend
  // on the column-major DOM order matching our (column, row) pair.
  createEffect(() => {
    const entry = selectedEntry();
    if (!entry) return;
    queueMicrotask(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-testid="workspace-switcher-card"][data-in-grid="${WORKSPACE_GRID_SLOT}"][data-terminal-id="${entry.id}"]`,
      );
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  return (
    <div
      data-testid="workspace-switcher-panel"
      class="grid grid-cols-[12rem_minmax(0,1fr)] flex-1 min-h-0 overflow-hidden"
    >
      <aside class="scrollbar-subtle border-r border-edge/60 py-3 px-2 overflow-y-auto">
        <div class="px-2 mb-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-3/80">
          repos
        </div>
        <RepoFacetButton
          label="All"
          count={totalCount()}
          color="var(--color-accent)"
          selected={model().selectedRepo === null}
          onClick={() => setRepoFilter(null)}
          data-testid="workspace-switcher-repo"
          data-selected={model().selectedRepo === null ? "" : undefined}
        />
        <div class="mt-0.5 flex flex-col gap-px">
          <Index each={model().repoFacets}>
            {(facet) => (
              <RepoFacetButton
                label={facet().repoName}
                count={facet().count}
                color={facet().color}
                selected={model().selectedRepo === facet().repoName}
                onClick={() =>
                  setRepoFilter(
                    model().selectedRepo === facet().repoName
                      ? null
                      : facet().repoName,
                  )
                }
                data-testid="workspace-switcher-repo"
                data-repo-name={facet().repoName}
                data-selected={
                  model().selectedRepo === facet().repoName ? "" : undefined
                }
              />
            )}
          </Index>
        </div>
      </aside>

      <section class="min-w-0 p-4 overflow-hidden">
        <div
          class="scrollbar-subtle grid gap-4 overflow-y-auto max-h-full px-1.5"
          style={{
            "grid-template-columns": `repeat(${columnCount()}, minmax(0, 1fr))`,
          }}
        >
          <Index each={model().columns}>
            {(column) => (
              <ColumnView
                column={column()}
                onSelect={props.onSelect}
                highlightedId={selectedEntry()?.id}
              />
            )}
          </Index>
        </div>
        <Show when={model().visibleEntries.length === 0}>
          <div class="mt-4 font-mono text-[0.75rem] text-fg-3/80 text-center tracking-wide">
            ── no live terminals match ──
          </div>
        </Show>
      </section>
    </div>
  );
};

/** Column body — handles both the flat agent-state columns and the
 *  Idle column's age sub-rows. Branches on `idleSubBuckets` so the
 *  renderer doesn't have to special-case the column key in every JSX
 *  block; the model already decided whether sub-rows are
 *  appropriate. */
const ColumnView: Component<{
  column: DockColumn;
  onSelect: (id: TerminalId) => void;
  highlightedId: TerminalId | undefined;
}> = (props) => (
  <div
    data-testid="workspace-switcher-column"
    data-agent-bucket={props.column.key}
    class="min-w-0"
  >
    <div
      class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b"
      style={{
        "border-color": `color-mix(in oklch, ${props.column.accentVar} 22%, var(--color-edge))`,
      }}
    >
      <div class="flex items-center gap-1.5 min-w-0">
        {/* Bucket-state pip — the same StatePip the dock row and tile
         *  title lead with, here labelling the whole column: the Working
         *  header carries the spinning ring, Awaiting/Idle a quiet dot.
         *  `unread` is a per-terminal notion, so a column header never
         *  escalates to the attention variant. Rendered unconditionally,
         *  like the dock and mobile rows — StatePip draws an empty cell
         *  for the No-agent ('none') bucket. */}
        <StatePip bucket={props.column.key} unread={false} />
        <div
          class={`font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] ${props.column.textClass}`}
        >
          {props.column.label}
        </div>
      </div>
      <div class="font-mono text-[0.65rem] text-fg-3 tabular-nums">
        {props.column.entries.length.toString().padStart(2, "0")}
      </div>
    </div>
    <Show
      when={
        props.column.key === "idle" ? props.column.idleSubBuckets : undefined
      }
      fallback={
        <EntryList
          entries={props.column.entries}
          empty={props.column.empty}
          onSelect={props.onSelect}
          highlightedId={props.highlightedId}
        />
      }
    >
      {(subBuckets) => (
        <div class="flex flex-col gap-3">
          <For each={subBuckets()}>
            {(sub) => (
              <div
                data-testid="workspace-switcher-idle-sub"
                data-idle-sub={sub.key}
                class="flex flex-col gap-2"
              >
                <div class="flex items-center justify-between gap-2 px-1">
                  <div class="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-3">
                    {sub.label}
                  </div>
                  <div class="font-mono text-[0.6rem] text-fg-3/70 tabular-nums">
                    {sub.entries.length.toString().padStart(2, "0")}
                  </div>
                </div>
                <EntryList
                  entries={sub.entries}
                  empty="empty"
                  onSelect={props.onSelect}
                  compactEmpty
                  highlightedId={props.highlightedId}
                />
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  </div>
);

const EntryList: Component<{
  entries: readonly DockEntry[];
  empty: string;
  compactEmpty?: boolean;
  onSelect: (id: TerminalId) => void;
  highlightedId: TerminalId | undefined;
}> = (props) => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  return (
    <div class="flex flex-col gap-2">
      <Show
        when={props.entries.length > 0}
        fallback={
          <div
            class={
              props.compactEmpty
                ? "font-mono text-[0.65rem] text-fg-3/40 tracking-wide pl-1"
                : "font-mono text-[0.7rem] text-fg-3/70 tracking-wide py-3 text-center"
            }
          >
            ── {props.empty} ──
          </div>
        }
      >
        <Index each={props.entries}>
          {(entry) => (
            <WorkspaceCard
              entry={entry()}
              active={tileStore.activeId() === entry().id}
              highlighted={props.highlightedId === entry().id}
              unread={store.isUnread(entry().id)}
              onSelect={() => props.onSelect(entry().id)}
            />
          )}
        </Index>
      </Show>
    </div>
  );
};

const RepoFacetButton: Component<{
  label: string;
  count: number;
  color: string;
  selected: boolean;
  onClick: () => void;
  "data-testid"?: string;
  "data-repo-name"?: string;
  "data-selected"?: string;
}> = (props) => (
  <button
    type="button"
    data-testid={props["data-testid"]}
    data-repo-name={props["data-repo-name"]}
    data-selected={props["data-selected"]}
    class="group/repo relative w-full flex items-center justify-between gap-2 pl-3 pr-2 py-1.5 rounded-md text-left cursor-pointer transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
    onClick={() => props.onClick()}
  >
    <span
      aria-hidden="true"
      class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-opacity duration-150"
      classList={{
        "opacity-100": props.selected,
        "opacity-0 group-hover/repo:opacity-40": !props.selected,
      }}
      style={{ "background-color": props.color }}
    />
    <span
      class="truncate text-sm transition-colors"
      classList={{
        "text-fg font-medium": props.selected,
        "text-fg-2 group-hover/repo:text-fg": !props.selected,
      }}
      style={props.selected ? { color: props.color } : undefined}
    >
      {props.label}
    </span>
    <span class="font-mono text-[0.7rem] tabular-nums text-fg-3 shrink-0">
      {props.count}
    </span>
  </button>
);

const WorkspaceCard: Component<{
  entry: DockEntry;
  active: boolean;
  /** Keyboard cursor — true when this card is the current arrow-key
   *  selection inside the palette body. Painted as a 2-px accent ring
   *  so it overrides the dim idle border and stays distinct from
   *  `active` (which uses the repo-color left rail). */
  highlighted: boolean;
  unread: boolean;
  onSelect: () => void;
}> = (props) => {
  const agent = () => activeArm(props.entry.info.meta)?.agent;
  const pr = () => activePr(props.entry.info.meta);
  const tokens = () => tokenLine(agent());
  const bucketInfo = () => bucketDescriptor(props.entry.bucket);
  const lastActive = () => formatTimeAgo(props.entry.info.meta.lastActivityAt);
  const idle = () => props.entry.bucket === "idle";

  return (
    <button
      type="button"
      data-testid="workspace-switcher-card"
      data-in-grid={WORKSPACE_GRID_SLOT}
      data-terminal-id={props.entry.id}
      data-repo-name={props.entry.repoName}
      data-agent-bucket={props.entry.bucket}
      data-active={props.active ? "" : undefined}
      data-highlighted={props.highlighted ? "" : undefined}
      class={`relative rounded-lg border p-2.5 text-left cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${props.active || idle() ? "" : bucketInfo().borderClass}`}
      classList={{
        "ring-2 ring-accent ring-offset-1 ring-offset-surface-1":
          props.highlighted,
        "border-edge-bright/70 bg-surface-0/60 shadow-[0_0_0_1px_color-mix(in_oklch,var(--card-color)_22%,transparent)]":
          props.active,
        "border-edge/60 bg-surface-0/60 hover:bg-surface-2/70 hover:border-edge-bright/70":
          !props.active,
        "opacity-60": idle() && !props.active && !props.highlighted,
      }}
      style={{
        "--card-color": props.entry.info.repoColor,
        "--pill-state-color": bucketInfo().accentVar,
        "--pill-border-radius": "calc(0.5rem + 2px)",
      }}
      onClick={() => props.onSelect()}
      title={props.entry.info.meta.cwd}
    >
      <Show when={props.active}>
        <span
          aria-hidden="true"
          class="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
          style={{ "background-color": props.entry.info.branchColor }}
        />
      </Show>
      <Show when={props.unread}>
        <span
          class="absolute right-2 top-2 inline-flex h-2 w-2"
          aria-hidden="true"
        >
          <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
          <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
        </span>
      </Show>

      {/* Eyebrow: repo identity + (right) PR badge if resolved.
       *  The merge-state icon + CI dot mirror the terminal title bar
       *  and dock row, so the workspace switcher card speaks the same
       *  PR vocabulary at a glance. The notes glyph is NOT rendered
       *  here — line 1 of the notes (or the branch fallback) lives in the
       *  headline below; rendering the glyph again as a separate chip
       *  would duplicate it. */}
      <div class="flex items-center justify-between gap-2 min-w-0">
        <span
          class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate min-w-0"
          style={{ color: props.entry.info.repoColor }}
        >
          {props.entry.repoName}
        </span>
        <Show when={pr()}>
          {(summary) => (
            <span
              class="flex items-center gap-1 text-[0.65rem] text-fg-2 shrink-0"
              data-testid="workspace-switcher-card-pr"
              title={prTooltip(summary())}
            >
              <PrStateIcon state={summary().state} class="w-3 h-3" />
              <Show when={summary().checks}>
                {(checks) => <ChecksIndicator status={checks()} />}
              </Show>
              <span class="font-mono tabular-nums">#{summary().number}</span>
            </span>
          )}
        </Show>
      </div>

      {/* Headline: annotation slot — notes line-1 if the user set
       *  one, otherwise the branch label (the human-readable anchor
       *  of the card). DM Sans semibold either way. */}
      <div class="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          data-testid="workspace-switcher-card-annotation"
          class="text-[0.95rem] font-semibold truncate leading-tight"
          style={{ color: props.entry.info.annotationColor }}
        >
          <NotesMarkdownInline
            markdown={annotationLine(
              props.entry.info.meta.notes,
              props.entry.label,
            )}
          />
        </span>
        <Show when={props.entry.suffix}>
          {(suffix) => (
            <span class="font-mono text-[0.6rem] tabular-nums text-fg-3 shrink-0">
              {suffix()}
            </span>
          )}
        </Show>
      </div>

      {/* Status: glyph color encodes bucket; agent label and tokens
       *  sit on the same line for left-edge scanability. */}
      <div class="mt-2 flex items-center gap-1.5 min-w-0 text-[0.72rem] text-fg-2">
        <span
          aria-hidden="true"
          class={`font-mono leading-none shrink-0 ${bucketInfo().textClass}`}
        >
          {bucketInfo().glyph}
        </span>
        <span class="truncate">{agentLabel(agent())}</span>
        <Show when={tokens()}>
          {(t) => (
            <span class="font-mono text-[0.62rem] text-fg-3 tabular-nums shrink-0 ml-auto">
              {t()}
            </span>
          )}
        </Show>
      </div>

      {/* Meta line: cwd or foreground process — a quiet trailing whisper. */}
      <div class="mt-0.5 flex items-baseline gap-2 font-mono text-[0.65rem] text-fg-3/90 min-w-0">
        <span class="truncate min-w-0">{metaLine(props.entry)}</span>
        <Show when={lastActive()}>
          {(label) => (
            <span
              data-testid="workspace-switcher-card-recency"
              class="tabular-nums text-fg-3/70 shrink-0 ml-auto"
              title={`Last agent activity: ${new Date(props.entry.info.meta.lastActivityAt).toLocaleString()}`}
            >
              {label()}
            </span>
          )}
        </Show>
      </div>

      {/* PR title row — only when resolved. The eyebrow above carries
       *  the merge-state icon, CI dot, and `#N`; this row is just the
       *  title text so the badge vocabulary doesn't duplicate. */}
      <Show when={pr()}>
        {(summary) => (
          <div class="mt-1 truncate text-[0.7rem] text-fg-2">
            {summary().title}
          </div>
        )}
      </Show>

      {/* Notes body — lines 2+ of the markdown when the user wrote
       *  multiline notes. Line 1 already lives in the annotation slot
       *  above; the body renders only when there's prose past line 1.
       *  The shared <NotesBody> box renders only in this switcher
       *  card (the canvas-tile and dock-awaiting card show only the
       *  line-1 annotation, plus — on the canvas-tile — a note-icon
       *  affordance gated on body presence). */}
      <NotesBody
        notes={props.entry.info.meta.notes}
        testId="workspace-switcher-card-notes"
      />
    </button>
  );
};

export default WorkspaceGrid;
