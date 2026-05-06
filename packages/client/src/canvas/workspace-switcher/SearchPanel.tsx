import type { TerminalId } from "kolu-common/surface";
import { type Component, createEffect, For, Index, Show } from "solid-js";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { CloseIcon } from "../../ui/Icons";
import { useTileTheme } from "../useTileTheme";
import { agentLabel, metaLine, prSummary, tokenLine } from "./chrome";
import { branchAccent, repoAccent } from "./identity";
import {
  agentBucket,
  bucketDescriptor,
  type WorkspaceSwitcherEntry,
  type WorkspaceSwitcherModel,
} from "./model";

/** Expanded hover panel with repo facets, search, and agent-state columns.
 *
 *  Reads as an operator's console: typographic hierarchy carries the load,
 *  not boxes-within-boxes. Repo identity (color) appears in the sidebar's
 *  selection bar, the card eyebrow, and the card border — three echoes of
 *  the same truth. */
const WorkspaceSearchPanel: Component<{
  model: WorkspaceSwitcherModel;
  query: string;
  focusSearch: boolean;
  onQueryChange: (query: string) => void;
  onSearchFocused: () => void;
  onRepoFilterChange: (repoName: string | null) => void;
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const columnCount = () => Math.max(1, props.model.columns.length);
  const totalCount = () =>
    props.model.repoFacets.reduce((sum, facet) => sum + facet.count, 0);
  let searchInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.focusSearch) return;
    queueMicrotask(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
      props.onSearchFocused();
    });
  });

  return (
    // Visibility is owned by the parent (rendered via `Show` only when
    // open). Keep the absolute wrapper transparent to hit-testing: it spans
    // the chrome width for layout, so letting it receive events creates an
    // invisible layer above the collapsed pills. The panel itself owns
    // pointer events; the parent keeps it alive briefly while crossing the
    // visual gap from strip to panel.
    <div class="pointer-events-none absolute inset-x-0 top-11 z-50 pt-2">
      <div
        data-testid="workspace-switcher-panel"
        id="workspace-switcher-panel"
        class="pointer-events-auto relative w-full max-w-[78rem] mx-auto overflow-hidden rounded-xl border border-edge/80 bg-surface-1/95 backdrop-blur-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.04)]"
        onPointerEnter={() => props.onPointerEnter()}
        onPointerLeave={() => props.onPointerLeave()}
      >
        {/* Top strip — search prompt + global count. The `>` glyph leans
         *  into the terminal-native aesthetic and replaces the generic
         *  bordered input box. */}
        <div class="flex items-center gap-3 px-4 h-10 border-b border-edge/60 bg-surface-0/40">
          <span
            aria-hidden="true"
            class="font-mono text-[0.85rem] leading-none text-accent select-none"
          >
            ⏵
          </span>
          <input
            ref={searchInputRef}
            data-testid="workspace-switcher-search"
            value={props.query}
            onInput={(e) => props.onQueryChange(e.currentTarget.value)}
            class="flex-1 min-w-0 bg-transparent border-0 outline-none font-mono text-[0.8rem] text-fg placeholder:text-fg-3/60 caret-accent"
            placeholder="repo, branch, pr, agent, cwd…"
            aria-label="Search workspaces"
            spellcheck={false}
            autocomplete="off"
          />
          <button
            type="button"
            data-testid="workspace-switcher-close"
            class="shrink-0 flex items-center justify-center w-6 h-6 -mr-1 rounded-md text-fg-3 hover:text-fg hover:bg-surface-2 active:bg-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-label="Close workspace switcher"
            title="Close (Esc)"
            onClick={() => props.onClose()}
          >
            <CloseIcon class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="grid grid-cols-[12rem_minmax(0,1fr)] max-h-[70vh] overflow-hidden">
          <aside class="scrollbar-subtle border-r border-edge/60 py-3 px-2 overflow-y-auto">
            <div class="px-2 mb-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-3/80">
              repos
            </div>
            <RepoFacetButton
              label="All"
              count={totalCount()}
              color="var(--color-accent)"
              selected={props.model.selectedRepo === null}
              onClick={() => props.onRepoFilterChange(null)}
              data-testid="workspace-switcher-repo"
              data-selected={props.model.selectedRepo === null ? "" : undefined}
            />
            <div class="mt-0.5 flex flex-col gap-px">
              <Index each={props.model.repoFacets}>
                {(facet) => (
                  <RepoFacetButton
                    label={facet().repoName}
                    count={facet().count}
                    color={facet().color}
                    selected={props.model.selectedRepo === facet().repoName}
                    onClick={() =>
                      props.onRepoFilterChange(
                        props.model.selectedRepo === facet().repoName
                          ? null
                          : facet().repoName,
                      )
                    }
                    data-testid="workspace-switcher-repo"
                    data-repo-name={facet().repoName}
                    data-selected={
                      props.model.selectedRepo === facet().repoName
                        ? ""
                        : undefined
                    }
                  />
                )}
              </Index>
            </div>
          </aside>

          <section class="min-w-0 p-4 overflow-hidden">
            <div
              class="scrollbar-subtle grid gap-4 overflow-y-auto max-h-[calc(70vh-3.5rem)] pr-1"
              style={{
                "grid-template-columns": `repeat(${columnCount()}, minmax(0, 1fr))`,
              }}
            >
              <For each={props.model.columns}>
                {(column) => (
                  <div
                    data-testid="workspace-switcher-column"
                    data-agent-bucket={column.key}
                    class="min-w-0"
                  >
                    <div
                      class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b"
                      style={{
                        "border-color": `color-mix(in oklch, ${column.accentVar} 22%, var(--color-edge))`,
                      }}
                    >
                      <div
                        class={`font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] ${column.textClass}`}
                      >
                        {column.label}
                      </div>
                      <div class="font-mono text-[0.65rem] text-fg-3 tabular-nums">
                        {column.entries.length.toString().padStart(2, "0")}
                      </div>
                    </div>
                    <div class="flex flex-col gap-2">
                      <Show
                        when={column.entries.length > 0}
                        fallback={
                          <div class="font-mono text-[0.7rem] text-fg-3/70 tracking-wide py-3 text-center">
                            ── {column.empty} ──
                          </div>
                        }
                      >
                        <For each={column.entries}>
                          {(entry) => (
                            <WorkspaceCard
                              entry={entry}
                              active={store.activeId() === entry.id}
                              unread={store.isUnread(entry.id)}
                              tileBg={tileTheme(entry.id).bg}
                              tileFg={tileTheme(entry.id).fg}
                              onSelect={() => props.onSelect(entry.id)}
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <Show when={props.model.visibleEntries.length === 0}>
              <div class="mt-4 font-mono text-[0.75rem] text-fg-3/80 text-center tracking-wide">
                ── no live terminals match ──
              </div>
            </Show>
          </section>
        </div>
      </div>
    </div>
  );
};

/** Sidebar facet row — left accent bar in repo color when selected,
 *  no fill. Count uses tabular nums so the column reads vertically. */
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

/** Single workspace card — eyebrow / headline / status / meta. Agent
 *  state lives on inactive card borders; active state uses a left rail so
 *  focus remains distinguishable even when the terminal is awaiting input. */
const WorkspaceCard: Component<{
  entry: WorkspaceSwitcherEntry;
  active: boolean;
  unread: boolean;
  tileBg: string;
  tileFg: string;
  onSelect: () => void;
}> = (props) => {
  const agent = () => props.entry.info.meta.agent;
  const pr = () => prSummary(props.entry);
  const tokens = () => tokenLine(agent());
  const bucketInfo = () => bucketDescriptor(agentBucket(agent()));

  return (
    <button
      type="button"
      data-testid="workspace-switcher-card"
      data-terminal-id={props.entry.id}
      data-repo-name={props.entry.repoName}
      data-agent-bucket={props.entry.bucket}
      data-active={props.active ? "" : undefined}
      // Active uses geometry, not fill color. Inactive cards keep the
      // agent-state border; the focused card gets a branch-colored rail.
      class={`relative rounded-lg border p-2.5 text-left cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${props.active ? "" : bucketInfo().borderClass}`}
      classList={{
        "border-edge-bright/70 bg-surface-0/60 shadow-[0_0_0_1px_color-mix(in_oklch,var(--card-color)_22%,transparent)]":
          props.active,
        "border-edge/60 bg-surface-0/60 hover:bg-surface-2/70 hover:border-edge-bright/70":
          !props.active,
      }}
      style={{
        "--card-color": repoAccent(props.entry.info),
        "--pill-state-color": bucketInfo().accentVar,
        // Override the pill-border ring radius so the agent-state border
        // follows the card's `rounded-lg` corners instead of drawing the
        // default pill oval. `inset: -2px` on ::before bumps the outer
        // radius by 2px to stay flush.
        "--pill-border-radius": "calc(0.5rem + 2px)",
      }}
      onClick={() => props.onSelect()}
      title={props.entry.info.meta.cwd}
    >
      <Show when={props.active}>
        <span
          aria-hidden="true"
          class="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
          style={{ "background-color": branchAccent(props.entry.info) }}
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
          style={{ color: repoAccent(props.entry.info) }}
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
       *  anchor of the card. Suffix renders in mono tabular when present. */}
      <div class="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          class="text-[0.95rem] font-semibold truncate leading-tight"
          style={{ color: branchAccent(props.entry.info) }}
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

      {/* Status: glyph color encodes bucket; agent label and tokens sit
       *  on the same line for left-edge scanability. */}
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
      <div class="mt-0.5 font-mono text-[0.65rem] text-fg-3/90 truncate">
        {metaLine(props.entry)}
      </div>

      {/* PR title row — only when resolved. The PR number already
       *  appears in the eyebrow, so this row carries title + checks. */}
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

export default WorkspaceSearchPanel;
