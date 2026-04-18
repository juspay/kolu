/** PillTree — floating two-level overlay on the canvas (repo → branches).
 *
 *  Replaces the focus-mode Sidebar. Sits at the top of the viewport,
 *  ghosted at rest and behind any tile that overlaps it; pops to full
 *  opacity above the tiles on hover. Click a branch pill → caller pans
 *  the viewport to center the corresponding tile.
 *
 *  Layout: repo groups flex-wrap horizontally so a few repos stay on
 *  one row; branch pills inside each repo lay out in a 3-column grid,
 *  one row per group of 3. Each grid row carries a leading ├─/└─ glyph
 *  so the parent→child relationship reads as a tree, not a soup. */

import { type Component, For, Show, createMemo } from "solid-js";
import type { TerminalId } from "kolu-common";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { PillRepoGroup, PillBranch } from "./pillTreeOrder";
import type { TileTheme } from "./tileChrome";
import { MinimapIcon } from "../ui/Icons";

const BRANCHES_PER_ROW = 3;

/** Chunk branches into rows of BRANCHES_PER_ROW so each row gets its
 *  own ├─/└─ glyph. Last row uses └─, all earlier ones ├─. */
function chunkBranches(branches: PillBranch[]): PillBranch[][] {
  const rows: PillBranch[][] = [];
  for (let i = 0; i < branches.length; i += BRANCHES_PER_ROW) {
    rows.push(branches.slice(i, i + BRANCHES_PER_ROW));
  }
  return rows;
}

const PillTree: Component<{
  groups: PillRepoGroup[];
  activeId: TerminalId | null;
  /** When true, the workspace is in fullscreen-one-tile mode. The tree
   *  recedes further and grows a leading "back to canvas" affordance —
   *  the visual signal that there's a canvas behind the maximized tile.
   *  Clicking a pill in maximized mode swaps which terminal is rendered
   *  fullscreen (via the caller's onSelect); no pan. */
  canvasMaximized: boolean;
  onExitMaximize: () => void;
  /** Lookup so each pill can colour itself by repo and surface unread/agent
   *  glow without the tree re-deriving any of that itself. */
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  /** Theme lookup so each pill takes the tile's title-bar tint —
   *  visually echoes the tile, doubles as a stable identity color. */
  getTileTheme: (id: TerminalId) => TileTheme;
  isUnread: (id: TerminalId) => boolean;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  // Stable repo color — first branch in the group always has one if any
  // terminal in the group has git context. Falls back to accent.
  const repoColor = (group: PillRepoGroup) => {
    for (const b of group.branches) {
      const c = props.getDisplayInfo(b.id)?.repoColor;
      if (c) return c;
    }
    return "var(--color-accent)";
  };

  const empty = createMemo(() => props.groups.length === 0);

  return (
    <Show when={!empty()}>
      <div
        data-testid="pill-tree"
        data-maximized={props.canvasMaximized ? "" : undefined}
        // Positioning is the caller's job (ChromeBar embeds this as a
        // flex child, mobile sheet renders its own vertical list).
        // `w-fit` keeps the tree at content width so the parent's
        // justify-center actually centers it instead of stretching the
        // tree across the whole header.
        class="group/pill-tree pointer-events-auto select-none w-fit"
      >
        <div
          class="flex flex-wrap items-start justify-center gap-x-3 gap-y-1 transition-opacity duration-150 group-hover/pill-tree:opacity-100"
          classList={{
            // Deeper recess in maximized mode: the user is focused on
            // one tile, the tree is a peripheral nav affordance; but it
            // stays readable at a glance so "there's a canvas behind
            // this" remains legible without a hover.
            "opacity-80": !props.canvasMaximized,
            "opacity-50": props.canvasMaximized,
          }}
        >
          <Show when={props.canvasMaximized}>
            <button
              data-testid="pill-tree-exit-maximize"
              class="flex items-center justify-center w-6 h-6 rounded-lg shrink-0 cursor-pointer text-fg-2 hover:text-fg hover:bg-surface-2/80 transition-colors"
              onClick={props.onExitMaximize}
              title="Show all on canvas"
            >
              <MinimapIcon class="w-3.5 h-3.5" />
            </button>
          </Show>
          <For each={props.groups}>
            {(group) => {
              const rows = createMemo(() => chunkBranches(group.branches));
              return (
                <div class="flex flex-col items-start gap-1 min-w-0">
                  <div class="flex items-baseline gap-2">
                    <div
                      data-testid="pill-tree-repo"
                      class="text-[0.65rem] font-semibold uppercase tracking-wide truncate max-w-[16ch]"
                      style={{ color: repoColor(group) }}
                      title={group.repoName}
                    >
                      {group.repoName}
                    </div>
                    <Show when={group.branches.length > 1}>
                      <span
                        data-testid="pill-tree-repo-count"
                        class="text-[0.6rem] font-mono text-fg-3 tabular-nums"
                      >
                        {group.branches.length}
                      </span>
                    </Show>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <For each={rows()}>
                      {(row, rowIdx) => {
                        const isLast = () => rowIdx() === rows().length - 1;
                        return (
                          <div class="flex items-center gap-1">
                            <span
                              aria-hidden="true"
                              class="font-mono text-[0.7rem] leading-none text-fg-3 select-none w-3 shrink-0"
                            >
                              {isLast() ? "└─" : "├─"}
                            </span>
                            <div class="grid grid-cols-3 gap-1">
                              <For each={row}>
                                {(b) => {
                                  const info = () => props.getDisplayInfo(b.id);
                                  const theme = () => props.getTileTheme(b.id);
                                  const active = () => props.activeId === b.id;
                                  const unread = () => props.isUnread(b.id);
                                  const agentState = () =>
                                    info()?.meta.agent?.state;
                                  // Tooltip shows the cwd (matches the
                                  // pre-#622 sidebar affordance).
                                  const tooltip = () =>
                                    info()?.meta.cwd ?? b.label;
                                  return (
                                    <button
                                      data-testid="pill-tree-branch"
                                      data-terminal-id={b.id}
                                      data-active={active() ? "" : undefined}
                                      data-unread={unread() ? "" : undefined}
                                      data-agent-state={agentState()}
                                      class="relative flex items-center gap-1 px-2 h-6 rounded-full text-xs transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] truncate"
                                      classList={{
                                        "ring-2 ring-accent/80 shadow":
                                          active(),
                                        "hover:ring-1 hover:ring-edge/60":
                                          !active(),
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
                                      <span class="truncate">{b.label}</span>
                                      <Show when={b.suffix}>
                                        {(suffix) => (
                                          <span
                                            data-testid="pill-tree-branch-suffix"
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
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
};

export default PillTree;
