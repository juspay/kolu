import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { SearchIcon } from "../../ui/Icons";
import { useTileTheme } from "../useTileTheme";
import {
  agentBorderClass,
  agentLabel,
  metaLine,
  prLine,
  tokenLine,
} from "./chrome";
import { branchAccent, repoAccent } from "./identity";
import type { WorkspaceSwitcherModel } from "./model";

/** Expanded hover panel with repo facets, search, and agent-state columns. */
const WorkspaceSearchPanel: Component<{
  model: WorkspaceSwitcherModel;
  query: string;
  onQueryChange: (query: string) => void;
  onRepoFilterChange: (repoName: string | null) => void;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const columnCount = () => Math.max(1, props.model.columns.length);

  return (
    <div
      data-testid="workspace-switcher-panel"
      class="pointer-events-auto hidden group-hover/workspace-switcher:block group-focus-within/workspace-switcher:block absolute left-1/2 top-9 z-50 w-full max-w-[78rem] -translate-x-1/2 rounded-lg border border-edge bg-surface-1/95 shadow-2xl backdrop-blur-md"
    >
      <div class="grid grid-cols-[13rem_minmax(0,1fr)] max-h-[70vh] overflow-hidden">
        <aside class="border-r border-edge/70 p-3 overflow-y-auto">
          <div class="text-[0.65rem] font-semibold uppercase tracking-wide text-fg-3 mb-2">
            Repos
          </div>
          <button
            type="button"
            data-testid="workspace-switcher-repo"
            data-selected={props.model.selectedRepo === null ? "" : undefined}
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "bg-surface-2 text-fg": props.model.selectedRepo === null,
              "text-fg-2": props.model.selectedRepo !== null,
            }}
            onClick={() => props.onRepoFilterChange(null)}
          >
            <span>All</span>
            <span class="font-mono text-xs text-fg-3">
              {props.model.repoFacets.reduce(
                (sum, facet) => sum + facet.count,
                0,
              )}
            </span>
          </button>
          <div class="mt-1 flex flex-col gap-0.5">
            <For each={props.model.repoFacets}>
              {(facet) => (
                <button
                  type="button"
                  data-testid="workspace-switcher-repo"
                  data-repo-name={facet.repoName}
                  data-selected={
                    props.model.selectedRepo === facet.repoName ? "" : undefined
                  }
                  class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  classList={{
                    "bg-surface-2 text-fg":
                      props.model.selectedRepo === facet.repoName,
                    "text-fg-2": props.model.selectedRepo !== facet.repoName,
                  }}
                  onClick={() =>
                    props.onRepoFilterChange(
                      props.model.selectedRepo === facet.repoName
                        ? null
                        : facet.repoName,
                    )
                  }
                >
                  <span class="truncate" style={{ color: facet.color }}>
                    {facet.repoName}
                  </span>
                  <span class="font-mono text-xs text-fg-3">{facet.count}</span>
                </button>
              )}
            </For>
          </div>
        </aside>

        <section class="min-w-0 p-3 overflow-hidden">
          <label class="flex items-center gap-2 h-9 px-3 rounded-md border border-edge bg-surface-0/80 text-fg-2 focus-within:border-accent/60 focus-within:text-fg">
            <SearchIcon class="w-3.5 h-3.5 shrink-0" />
            <input
              data-testid="workspace-switcher-search"
              value={props.query}
              onInput={(e) => props.onQueryChange(e.currentTarget.value)}
              class="w-full min-w-0 bg-transparent border-0 outline-none text-sm text-fg placeholder:text-fg-3"
              placeholder="Search repo, branch, PR, agent, cwd..."
              aria-label="Search workspaces"
            />
          </label>

          <div
            class="mt-3 grid gap-3 overflow-y-auto max-h-[calc(70vh-5.25rem)] pr-1"
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
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="text-xs font-semibold text-fg">
                      {column.label}
                    </div>
                    <div class="font-mono text-[0.65rem] text-fg-3">
                      {column.entries.length}
                    </div>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Show
                      when={column.entries.length > 0}
                      fallback={
                        <div class="rounded-md border border-dashed border-edge/70 px-3 py-4 text-xs text-fg-3">
                          {column.empty}
                        </div>
                      }
                    >
                      <For each={column.entries}>
                        {(entry) => {
                          const theme = () => tileTheme(entry.id);
                          const active = () => store.activeId() === entry.id;
                          const unread = () => store.isUnread(entry.id);
                          const agent = () => entry.info.meta.agent;
                          const pr = () => prLine(entry);
                          return (
                            <button
                              type="button"
                              data-testid="workspace-switcher-card"
                              data-terminal-id={entry.id}
                              data-repo-name={entry.repoName}
                              data-agent-bucket={entry.bucket}
                              data-active={active() ? "" : undefined}
                              class={`relative min-h-24 rounded-md border p-2.5 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${agentBorderClass(agent()?.state)}`}
                              classList={{
                                "border-accent/70 bg-surface-2":
                                  active() && !agent(),
                                "border-edge/70 bg-surface-0/80 hover:bg-surface-2/80":
                                  !active(),
                                "pill-glow-inner": active() && !!agent(),
                              }}
                              style={{
                                "--card-color": repoAccent(entry.info),
                              }}
                              onClick={() => props.onSelect(entry.id)}
                              title={entry.info.meta.cwd}
                            >
                              <Show when={unread()}>
                                <span
                                  class="absolute right-2 top-2 h-2 w-2 rounded-full bg-alert"
                                  aria-hidden="true"
                                />
                              </Show>
                              <div class="flex items-center gap-2 min-w-0">
                                <span
                                  class="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{
                                    "background-color": branchAccent(
                                      entry.info,
                                    ),
                                    border: `1px solid ${theme().fg}`,
                                  }}
                                />
                                <span
                                  class="text-[0.65rem] font-semibold uppercase tracking-wide truncate"
                                  style={{ color: repoAccent(entry.info) }}
                                >
                                  {entry.repoName}
                                </span>
                              </div>
                              <div class="mt-1 flex items-center gap-1 min-w-0">
                                <span
                                  class="text-sm font-medium truncate"
                                  style={{ color: branchAccent(entry.info) }}
                                >
                                  {entry.label}
                                </span>
                                <Show when={entry.suffix}>
                                  {(suffix) => (
                                    <span class="font-mono text-[0.6rem] text-fg-3 shrink-0">
                                      {suffix()}
                                    </span>
                                  )}
                                </Show>
                              </div>
                              <div class="mt-1 text-xs text-fg-2 truncate">
                                {agentLabel(agent())}
                                <Show when={tokenLine(agent())}>
                                  {(tokens) => (
                                    <span class="font-mono text-fg-3">
                                      {" "}
                                      · {tokens()}
                                    </span>
                                  )}
                                </Show>
                              </div>
                              <div class="mt-1 text-xs text-fg-3 truncate">
                                {metaLine(entry)}
                              </div>
                              <Show when={pr()}>
                                {(line) => (
                                  <div class="mt-1 text-xs text-fg-2 truncate">
                                    {line()}
                                  </div>
                                )}
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
          <Show when={props.model.visibleEntries.length === 0}>
            <div class="mt-3 rounded-md border border-dashed border-edge px-3 py-6 text-center text-sm text-fg-3">
              No live terminals match
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
};

export default WorkspaceSearchPanel;
