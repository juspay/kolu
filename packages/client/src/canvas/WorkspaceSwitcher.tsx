/** WorkspaceSwitcher — floating live-terminal navigator on the canvas.
 *
 *  Replaces the focus-mode Sidebar. Sits at the top of the viewport,
 *  ghosted at rest and behind any tile that overlaps it; pops to full
 *  opacity above the tiles on hover. Click a compact pill or panel card and
 *  the caller chooses the focus behavior.
 *
 *  Layout: a compact repo/branch pill strip stays visible at rest; hover
 *  opens a search-and-facet panel grouped by live agent state. */

import type { AgentInfo, TerminalId } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { agentNames, stateLabels } from "../ui/agentDisplay";
import { PlusIcon, SearchIcon } from "../ui/Icons";
import {
  type WorkspaceSwitcherItem,
  type WorkspaceSwitcherRepoGroup,
  repoColor,
} from "./workspaceSwitcherOrder";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import {
  buildWorkspaceSwitcherModel,
  type WorkspaceSwitcherEntry,
} from "./workspaceSwitcherModel";

const BRANCHES_PER_ROW = 3;

/** Chunk compact items into rows of BRANCHES_PER_ROW so each row gets its
 *  own ├─/└─ glyph. Last row uses └─, all earlier ones ├─. */
function chunkItems(items: WorkspaceSwitcherItem[]): WorkspaceSwitcherItem[][] {
  const rows: WorkspaceSwitcherItem[][] = [];
  for (let i = 0; i < items.length; i += BRANCHES_PER_ROW) {
    rows.push(items.slice(i, i + BRANCHES_PER_ROW));
  }
  return rows;
}

function agentBorderClass(state: AgentInfo["state"] | undefined): string {
  return match(state)
    .with(P.union("thinking", "tool_use"), () => "pill-border pill-border-spin")
    .with("waiting", () => "pill-border pill-border-waiting")
    .with(undefined, () => "")
    .exhaustive();
}

function agentLabel(agent: AgentInfo | null | undefined): string {
  if (!agent) return "Plain shell";
  return `${agentNames[agent.kind]} · ${stateLabels[agent.state]}`;
}

function metaLine(entry: WorkspaceSwitcherEntry): string {
  const { meta } = entry.info;
  if (meta.agent?.summary) return meta.agent.summary;
  if (meta.foreground?.title) return meta.foreground.title;
  if (meta.foreground?.name) return meta.foreground.name;
  return meta.cwd;
}

function prLine(entry: WorkspaceSwitcherEntry): string | null {
  const pr = entry.info.meta.pr;
  if (pr.kind !== "ok") return null;
  const checks = pr.value.checks ? ` · ${pr.value.checks}` : "";
  return `#${pr.value.number} ${pr.value.title}${checks}`;
}

const tokenFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function tokenLine(agent: AgentInfo | null | undefined): string | null {
  if (!agent?.contextTokens) return null;
  return tokenFormat.format(agent.contextTokens);
}

const WorkspaceSwitcher: Component<{
  groups: WorkspaceSwitcherRepoGroup[];
  /** Click handler — caller decides whether to pan, swap active, etc.
   *  Identity (active terminal, maximized mode, display info, tile theme,
   *  unread) is read from singleton hooks inside the switcher, so the component
   *  has zero coupling to App.tsx state wiring. */
  onSelect: (id: TerminalId) => void;
  /** Open the "new terminal" flow (palette filtered to that group, where
   *  the user can pick a recent cwd or create a worktree). Wired to a
   *  trailing `+` button on the compact row — affordance for users who
   *  haven't yet learned the keyboard shortcut. */
  onCreate: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const posture = useViewPosture();
  const [query, setQuery] = createSignal("");
  const [repoFilter, setRepoFilter] = createSignal<string | null>(null);
  const switcher = createMemo(() =>
    buildWorkspaceSwitcherModel(props.groups, store.getDisplayInfo, {
      query: query(),
      repoFilter: repoFilter(),
    }),
  );

  return (
    <div
      data-testid="workspace-switcher"
      data-maximized={posture.maximized() ? "" : undefined}
      // Positioning is the caller's job (ChromeBar embeds this as a
      // flex child, mobile sheet renders its own vertical list).
      // The outer fills its slot; `justify-center` on the inner
      // clusters items toward the middle so 3 repos at rest don't
      // spread edge-to-edge. flex-wrap kicks in only when content
      // genuinely exceeds the slot.
      //
      // pointer-events-none on the wrapper so the empty middle of
      // the chrome (between pills) passes clicks through to the
      // right-panel tab bar / canvas underneath; the actual pill
      // buttons re-enable pointer events on themselves.
      class="group/workspace-switcher pointer-events-none select-none w-full relative"
    >
      <div
        // flex-nowrap: repos stay on a single row. Item overflow happens
        // inside each repo (chunkItems -> multi-row grid), and rows beyond
        // the first stay collapsed while the hover panel carries the full list.
        class="flex flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150 group-hover/workspace-switcher:opacity-100 group-focus-within/workspace-switcher:opacity-100"
        classList={{
          // Deeper recess in maximized mode: the user is focused on
          // one tile, the switcher is a peripheral nav affordance; but it
          // stays readable at a glance so "there's a canvas behind
          // this" remains legible without a hover.
          "opacity-80": !posture.maximized(),
          "opacity-50": posture.maximized(),
        }}
      >
        {/* "+" button — opens the new-terminal palette group (recent
         *  cwds + worktree create flow). Sits before the repo groups
         *  so it stays in a stable position regardless of how many
         *  repos are open. Same h-6 as a branch pill so the row
         *  baselines align. */}
        <button
          type="button"
          data-testid="workspace-switcher-new"
          class="pointer-events-auto flex items-center justify-center w-6 h-6 mt-3 rounded-full shrink-0 cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={props.onCreate}
          aria-label="New terminal"
          title="New terminal"
        >
          <PlusIcon class="w-3.5 h-3.5" />
        </button>
        <For each={props.groups}>
          {(group) => {
            const rows = createMemo(() => chunkItems(group.items));
            return (
              // pointer-events-auto on the column so the 4 px row-gap
              // (and the between-pill gaps inside a row) stay part of
              // the hover target. Without this, a cursor travelling
              // from a row-1 pill toward the expanded switcher panel
              // crosses a transparent band that inherits `none` from
              // the outer wrapper. This keeps the repo column a real
              // hover target. The outer wrapper stays
              // `pointer-events-none` so the empty chrome between
              // repo groups still passes clicks through to the canvas.
              <div class="pointer-events-auto flex flex-col items-start gap-1 min-w-0">
                <div
                  data-testid="workspace-switcher-compact-repo"
                  class="text-[0.65rem] font-semibold uppercase tracking-wide truncate max-w-[16ch]"
                  style={{ color: repoColor(group, store.getDisplayInfo) }}
                  title={group.repoName}
                >
                  {group.repoName}
                </div>
                {/* Rows past the first stay display:none in the collapsed
                 *  form; the hover panel carries the full live workspace list.
                 *  Avoids `max-h + overflow-hidden`,
                 *  which clipped the active pill's ring-2 outline on
                 *  its top/bottom arcs. */}
                <div class="flex flex-col gap-1">
                  <For each={rows()}>
                    {(row, rowIdx) => {
                      const isLast = () => rowIdx() === rows().length - 1;
                      return (
                        <div
                          class="items-center gap-1"
                          classList={{
                            flex: rowIdx() === 0,
                            hidden: rowIdx() > 0,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            class="font-mono text-[0.7rem] leading-none text-fg-3 select-none w-3 shrink-0"
                          >
                            {isLast() ? "└─" : "├─"}
                          </span>
                          {/* `auto` columns size to content — a repo
                           *  with only 2 pills doesn't reserve a 3rd
                           *  column's width (which would happen with
                           *  `grid-cols-3` = `repeat(3, 1fr)`). Vertical
                           *  alignment across rows holds because both
                           *  use the same column-sizing rule. */}
                          <div class="grid grid-cols-[repeat(3,auto)] gap-1">
                            <For each={row}>
                              {(b) => {
                                const info = () => store.getDisplayInfo(b.id);
                                const theme = () => tileTheme(b.id);
                                const active = () => store.activeId() === b.id;
                                const unread = () => store.isUnread(b.id);
                                const agentState = () =>
                                  info()?.meta.agent?.state;
                                // Tooltip shows the cwd (matches the
                                // pre-#622 sidebar affordance).
                                const tooltip = () =>
                                  info()?.meta.cwd ?? b.label;
                                // Two orthogonal border concerns,
                                // composed via classList. Agent state
                                // drives the animation; active drives
                                // the inset glow / static ring.
                                const borderClass = () =>
                                  agentBorderClass(agentState());
                                return (
                                  <button
                                    type="button"
                                    data-testid="workspace-switcher-pill"
                                    data-terminal-id={b.id}
                                    data-active={active() ? "" : undefined}
                                    data-unread={unread() ? "" : undefined}
                                    data-agent-state={agentState()}
                                    class={`pointer-events-auto flex items-center gap-1 px-2 h-6 rounded-full text-xs cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] whitespace-nowrap ${borderClass()}`}
                                    classList={{
                                      // Static repo-colored ring when
                                      // active and no agent animation
                                      // is already painting one.
                                      "pill-border pill-border-active":
                                        active() && !agentState(),
                                      // Inset glow whenever the active
                                      // pill ALSO has an agent animation
                                      // running — distinguishes "focus"
                                      // from "agent-running-elsewhere".
                                      "pill-glow-inner":
                                        active() && !!agentState(),
                                      // Hover ring only when no other
                                      // border is doing work — a tiny
                                      // discoverability cue for idle,
                                      // unfocused pills. Doesn't fight
                                      // the animated pseudo-border.
                                      "hover:ring-1 hover:ring-edge/60":
                                        !active() && !agentState(),
                                    }}
                                    style={{
                                      // Pill bg = terminal's BG color,
                                      // text = its FG color. Each pill
                                      // is a literal swatch of its
                                      // terminal — clearest visual
                                      // pill ↔ tile link without the
                                      // brightness of full inversion.
                                      "background-color": theme().bg,
                                      color: theme().fg,
                                      // --card-color drives the pseudo
                                      // border's color (spin / breathe /
                                      // solid). Repo color so the border
                                      // doubles as identity.
                                      "--card-color":
                                        info()?.repoColor ??
                                        "var(--color-accent)",
                                    }}
                                    onClick={() => props.onSelect(b.id)}
                                    title={tooltip()}
                                  >
                                    <Show when={unread()}>
                                      <span
                                        class="absolute -top-0.5 -right-0.5 inline-flex h-2 w-2"
                                        aria-hidden="true"
                                      >
                                        <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
                                        <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
                                      </span>
                                    </Show>
                                    <span class="truncate min-w-0">
                                      {b.label}
                                    </span>
                                    <Show when={b.suffix}>
                                      {(suffix) => (
                                        <span
                                          data-testid="workspace-switcher-pill-suffix"
                                          class="font-mono text-[0.6rem] text-fg-3 tabular-nums shrink-0"
                                        >
                                          {suffix()}
                                        </span>
                                      )}
                                    </Show>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
                {/* "+N" hint: only when extra compact rows are hidden at rest.
                 *  The expanded panel takes over on hover/focus. */}
                <Show when={group.items.length > BRANCHES_PER_ROW}>
                  <span
                    data-testid="workspace-switcher-more"
                    class="ml-4 text-[0.55rem] font-mono text-fg-3 leading-none group-hover/workspace-switcher:hidden group-focus-within/workspace-switcher:hidden"
                  >
                    ▾ +{group.items.length - BRANCHES_PER_ROW}
                  </span>
                </Show>
              </div>
            );
          }}
        </For>

        <div
          data-testid="workspace-switcher-panel"
          class="pointer-events-auto hidden group-hover/workspace-switcher:block group-focus-within/workspace-switcher:block absolute left-1/2 top-9 z-50 w-[min(78rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-edge bg-surface-1/95 shadow-2xl backdrop-blur-md"
        >
          <div class="grid grid-cols-[13rem_minmax(0,1fr)] max-h-[70vh] overflow-hidden">
            <aside class="border-r border-edge/70 p-3 overflow-y-auto">
              <div class="text-[0.65rem] font-semibold uppercase tracking-wide text-fg-3 mb-2">
                Repos
              </div>
              <button
                type="button"
                data-testid="workspace-switcher-repo"
                data-selected={repoFilter() === null ? "" : undefined}
                class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                classList={{
                  "bg-surface-2 text-fg": repoFilter() === null,
                  "text-fg-2": repoFilter() !== null,
                }}
                onClick={() => setRepoFilter(null)}
              >
                <span>All</span>
                <span class="font-mono text-xs text-fg-3">
                  {switcher().repoFacets.reduce(
                    (sum, facet) => sum + facet.count,
                    0,
                  )}
                </span>
              </button>
              <div class="mt-1 flex flex-col gap-0.5">
                <For each={switcher().repoFacets}>
                  {(facet) => (
                    <button
                      type="button"
                      data-testid="workspace-switcher-repo"
                      data-repo-name={facet.repoName}
                      data-selected={
                        repoFilter() === facet.repoName ? "" : undefined
                      }
                      class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      classList={{
                        "bg-surface-2 text-fg": repoFilter() === facet.repoName,
                        "text-fg-2": repoFilter() !== facet.repoName,
                      }}
                      onClick={() =>
                        setRepoFilter((current) =>
                          current === facet.repoName ? null : facet.repoName,
                        )
                      }
                    >
                      <span class="truncate">{facet.repoName}</span>
                      <span class="font-mono text-xs text-fg-3">
                        {facet.count}
                      </span>
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
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  class="w-full min-w-0 bg-transparent border-0 outline-none text-sm text-fg placeholder:text-fg-3"
                  placeholder="Search repo, branch, PR, agent, cwd..."
                  aria-label="Search workspaces"
                />
              </label>

              <div class="mt-3 grid grid-cols-3 gap-3 overflow-y-auto max-h-[calc(70vh-5.25rem)] pr-1">
                <For each={switcher().columns}>
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
                              const active = () =>
                                store.activeId() === entry.id;
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
                                    "--card-color":
                                      entry.info.repoColor ??
                                      "var(--color-accent)",
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
                                        "background-color": theme().bg,
                                        border: `1px solid ${theme().fg}`,
                                      }}
                                    />
                                    <span class="text-[0.65rem] font-semibold uppercase tracking-wide truncate text-fg-3">
                                      {entry.repoName}
                                    </span>
                                  </div>
                                  <div class="mt-1 flex items-center gap-1 min-w-0">
                                    <span class="text-sm font-medium text-fg truncate">
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
              <Show when={switcher().visibleEntries.length === 0}>
                <div class="mt-3 rounded-md border border-dashed border-edge px-3 py-6 text-center text-sm text-fg-3">
                  No live terminals match
                </div>
              </Show>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSwitcher;
