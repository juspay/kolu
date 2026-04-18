/** PillTree — floating two-level overlay on the canvas (repo → branches).
 *
 *  Replaces the focus-mode Sidebar. Sits at the top of the viewport,
 *  ghosted at rest and behind any tile that overlaps it; pops to full
 *  opacity above the tiles on hover. Click a branch pill → caller pans
 *  the viewport to center the corresponding tile. */

import { type Component, For, Show, createMemo } from "solid-js";
import type { TerminalId } from "kolu-common";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { PillRepoGroup } from "./pillTreeOrder";

const PillTree: Component<{
  groups: PillRepoGroup[];
  activeId: TerminalId | null;
  /** Lookup so each pill can colour itself by repo and surface unread/agent
   *  glow without the tree re-deriving any of that itself. */
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
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
        // Per #622, the pill tree sits BEHIND tiles at rest (z-0; tiles
        // start at z-1) and pops above on hover (z-30). Pointer events
        // pass through to whatever overlays it until the user explicitly
        // hovers — so a tile's title bar stays double-clickable for
        // maximize even when the pill tree visually overlaps it.
        class="absolute top-3 left-1/2 -translate-x-1/2 z-0 hover:z-30 group/pill-tree pointer-events-auto select-none"
      >
        <div class="flex items-start gap-3 px-3 py-2 rounded-2xl bg-surface-1/40 backdrop-blur-md border border-edge/30 shadow-sm transition-opacity duration-150 opacity-50 group-hover/pill-tree:opacity-100">
          <For each={props.groups}>
            {(group) => (
              <div class="flex flex-col items-start gap-1">
                <div
                  data-testid="pill-tree-repo"
                  class="text-[0.65rem] font-semibold uppercase tracking-wide truncate max-w-[16ch]"
                  style={{ color: repoColor(group) }}
                  title={group.repoName}
                >
                  {group.repoName}
                </div>
                <div class="flex items-center gap-1 flex-wrap">
                  <For each={group.branches}>
                    {(b) => {
                      const info = () => props.getDisplayInfo(b.id);
                      const active = () => props.activeId === b.id;
                      const unread = () => props.isUnread(b.id);
                      const agentState = () => info()?.meta.agent?.state;
                      // Tooltip shows the cwd (matches the pre-#622 sidebar
                      // affordance — hover any entry to see the full path).
                      const tooltip = () => info()?.meta.cwd ?? b.label;
                      return (
                        <button
                          data-testid="pill-tree-branch"
                          data-terminal-id={b.id}
                          data-active={active() ? "" : undefined}
                          data-unread={unread() ? "" : undefined}
                          data-agent-state={agentState()}
                          class="relative flex items-center gap-1 px-2 h-6 rounded-full text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] truncate"
                          classList={{
                            "bg-accent/30 text-fg ring-1 ring-accent/60":
                              active(),
                            "text-fg-2 hover:bg-surface-2/80 hover:text-fg":
                              !active(),
                          }}
                          style={{
                            "border-color": active()
                              ? repoColor(group)
                              : undefined,
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
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};

export default PillTree;
