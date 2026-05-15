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

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  For,
  Index,
  Show,
  createMemo,
  createSignal,
} from "solid-js";
import { formatTimeAgo, useIdleClassifier } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileTheme } from "../useTileTheme";
import {
  bucketDescriptor,
  buildDockModel,
  type DockColumn,
  type DockEntry,
  type DockSourceEntry,
} from "../dockModel";
import { agentLabel, metaLine, prSummary, tokenLine } from "./dockRowChrome";

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
          class="scrollbar-subtle grid gap-4 overflow-y-auto max-h-full pr-1"
          style={{
            "grid-template-columns": `repeat(${columnCount()}, minmax(0, 1fr))`,
          }}
        >
          <Index each={model().columns}>
            {(column) => (
              <ColumnView column={column()} onSelect={props.onSelect} />
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
      <div
        class={`font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] ${props.column.textClass}`}
      >
        {props.column.label}
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
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
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
              active={store.activeId() === entry().id}
              unread={store.isUnread(entry().id)}
              tileBg={tileTheme(entry().id).bg}
              tileFg={tileTheme(entry().id).fg}
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
  unread: boolean;
  tileBg: string;
  tileFg: string;
  onSelect: () => void;
}> = (props) => {
  const agent = () => props.entry.info.meta.agent;
  const pr = () => prSummary(props.entry);
  const tokens = () => tokenLine(agent());
  const bucketInfo = () => bucketDescriptor(props.entry.bucket);
  const lastActive = () => formatTimeAgo(props.entry.info.meta.lastActivityAt);
  const idle = () => props.entry.bucket === "idle";

  return (
    <button
      type="button"
      data-testid="workspace-switcher-card"
      data-terminal-id={props.entry.id}
      data-repo-name={props.entry.repoName}
      data-agent-bucket={props.entry.bucket}
      data-active={props.active ? "" : undefined}
      class={`relative rounded-lg border p-2.5 text-left cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${props.active || idle() ? "" : bucketInfo().borderClass}`}
      classList={{
        "border-edge-bright/70 bg-surface-0/60 shadow-[0_0_0_1px_color-mix(in_oklch,var(--card-color)_22%,transparent)]":
          props.active,
        "border-edge/60 bg-surface-0/60 hover:bg-surface-2/70 hover:border-edge-bright/70":
          !props.active,
        "opacity-60": idle() && !props.active,
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

      {/* Eyebrow: repo identity + (right) PR # if resolved. */}
      <div class="flex items-center justify-between gap-2 min-w-0">
        <span
          class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate min-w-0"
          style={{ color: props.entry.info.repoColor }}
        >
          {props.entry.repoName}
        </span>
        <Show when={pr()}>
          {(summary) => (
            <span class="font-mono text-[0.65rem] tabular-nums text-fg-2 shrink-0">
              #{summary().number}
            </span>
          )}
        </Show>
      </div>

      {/* Headline: branch label — DM Sans semibold, the human-readable
       *  anchor of the card. */}
      <div class="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          class="text-[0.95rem] font-semibold truncate leading-tight"
          style={{ color: props.entry.info.branchColor }}
        >
          {props.entry.label}
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

      {/* PR title row — only when resolved. */}
      <Show when={pr()}>
        {(summary) => (
          <div class="mt-1 text-[0.7rem] text-fg-2 truncate">
            <span class="truncate">{summary().title}</span>
            <Show when={summary().checks}>
              {(checks) => (
                <span class="font-mono text-fg-3 tabular-nums">
                  {" · "}
                  {checks()}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
    </button>
  );
};

export default WorkspaceGrid;
