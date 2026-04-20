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
import { match, P } from "ts-pattern";
import type { TerminalId } from "kolu-common";
import { useTerminalStore } from "../terminal/useTerminalStore";
import {
  type PillRepoGroup,
  type PillBranch,
  repoColor,
} from "./pillTreeOrder";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import { MinimapIcon, PlusIcon } from "../ui/Icons";

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
  /** Click handler — caller decides whether to pan, swap active, etc.
   *  Identity (active terminal, maximized mode, display info, tile theme,
   *  unread) is read from singleton hooks inside the tree, so the tree
   *  has zero coupling to App.tsx state wiring. */
  onSelect: (id: TerminalId) => void;
  /** Open the "new terminal" flow (palette filtered to that group, where
   *  the user can pick a recent cwd or create a worktree). Wired to a
   *  trailing `+` button on the tree's row — affordance for users who
   *  haven't yet learned the keyboard shortcut. */
  onCreate: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const posture = useViewPosture();

  return (
    <div
      data-testid="pill-tree"
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
      class="group/pill-tree pointer-events-none select-none w-full"
    >
      <div
        // flex-nowrap: repos stay on a single row. Branch overflow
        // happens INSIDE each repo (chunkBranches → multi-row grid),
        // and that overflow is hidden at rest by a max-height cap on
        // the rows container below — only revealed on hover.
        class="flex flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150 group-hover/pill-tree:opacity-100"
        classList={{
          // Deeper recess in maximized mode: the user is focused on
          // one tile, the tree is a peripheral nav affordance; but it
          // stays readable at a glance so "there's a canvas behind
          // this" remains legible without a hover.
          "opacity-80": !posture.maximized(),
          "opacity-50": posture.maximized(),
        }}
      >
        <Show when={posture.maximized()}>
          <button
            data-testid="pill-tree-exit-maximize"
            class="pointer-events-auto flex items-center justify-center w-6 h-6 rounded-lg shrink-0 cursor-pointer text-fg-2 hover:text-fg hover:bg-surface-2/80 transition-colors"
            onClick={posture.toggle}
            title="Show all on canvas"
          >
            <MinimapIcon class="w-3.5 h-3.5" />
          </button>
        </Show>
        {/* "+" button — opens the new-terminal palette group (recent
         *  cwds + worktree create flow). Sits before the repo groups
         *  so it stays in a stable position regardless of how many
         *  repos are open. Same h-6 as a branch pill so the row
         *  baselines align. */}
        <button
          data-testid="pill-tree-new"
          class="pointer-events-auto flex items-center justify-center w-6 h-6 mt-3 rounded-full shrink-0 cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={props.onCreate}
          aria-label="New terminal"
          title="New terminal"
        >
          <PlusIcon class="w-3.5 h-3.5" />
        </button>
        <For each={props.groups}>
          {(group) => {
            const rows = createMemo(() => chunkBranches(group.branches));
            return (
              <div class="flex flex-col items-start gap-1 min-w-0">
                <div
                  data-testid="pill-tree-repo"
                  class="text-[0.65rem] font-semibold uppercase tracking-wide truncate max-w-[16ch]"
                  style={{ color: repoColor(group, store.getDisplayInfo) }}
                  title={group.repoName}
                >
                  {group.repoName}
                </div>
                {/* Rows past the first are display:none at rest and
                 *  revealed on hover. Avoids `max-h + overflow-hidden`,
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
                            "hidden group-hover/pill-tree:flex": rowIdx() > 0,
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
                                // the inset glow / static ring. Adding
                                // a new agent variant only touches
                                // `agentBorderClass` — the active path
                                // doesn't need to be re-audited.
                                const agentBorderClass = () =>
                                  match(agentState())
                                    .with(
                                      P.union("thinking", "tool_use"),
                                      () => "pill-border pill-border-spin",
                                    )
                                    .with(
                                      "waiting",
                                      () => "pill-border pill-border-waiting",
                                    )
                                    .with(undefined, () => "")
                                    .exhaustive();
                                return (
                                  <button
                                    data-testid="pill-tree-branch"
                                    data-terminal-id={b.id}
                                    data-active={active() ? "" : undefined}
                                    data-unread={unread() ? "" : undefined}
                                    data-agent-state={agentState()}
                                    class={`pointer-events-auto flex items-center gap-1 px-2 h-6 rounded-full text-xs cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] whitespace-nowrap ${agentBorderClass()}`}
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
                {/* "+N" hint: only when extra rows are clipped at rest.
                 *  Hides on hover (when the cap lifts and all rows show).
                 *  Tells the user "there's more — hover to reveal" without
                 *  needing a separate icon or tooltip. */}
                <Show when={group.branches.length > BRANCHES_PER_ROW}>
                  <span
                    data-testid="pill-tree-more"
                    class="ml-4 text-[0.55rem] font-mono text-fg-3 leading-none group-hover/pill-tree:hidden"
                  >
                    ▾ +{group.branches.length - BRANCHES_PER_ROW}
                  </span>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default PillTree;
