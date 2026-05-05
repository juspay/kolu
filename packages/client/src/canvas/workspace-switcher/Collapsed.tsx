import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PlusIcon } from "../../ui/Icons";
import { useTileTheme } from "../useTileTheme";
import { agentBorderClass } from "./chrome";
import { branchAccent, repoAccent } from "./identity";
import type {
  WorkspaceSwitcherCompactItem,
  WorkspaceSwitcherRepoGroup,
} from "./model";

const ITEMS_PER_ROW = 3;

function chunkItems(
  items: WorkspaceSwitcherCompactItem[],
): WorkspaceSwitcherCompactItem[][] {
  const rows: WorkspaceSwitcherCompactItem[][] = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_ROW) {
    rows.push(items.slice(i, i + ITEMS_PER_ROW));
  }
  return rows;
}

/** Collapsed desktop switcher: compact repo headings plus branch pills. */
const CollapsedWorkspaceSwitcher: Component<{
  groups: WorkspaceSwitcherRepoGroup[];
  onCreate: () => void;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();

  return (
    <>
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
            <div class="pointer-events-auto flex flex-col items-start gap-1 min-w-0">
              <div
                data-testid="workspace-switcher-compact-repo"
                class="text-[0.65rem] font-semibold uppercase tracking-wide truncate max-w-[16ch]"
                style={{ color: group.color }}
                title={group.repoName}
              >
                {group.repoName}
              </div>

              <div class="flex flex-col gap-1">
                <For each={rows()}>
                  {(row, rowIdx) => {
                    const isLast = () => rowIdx() === rows().length - 1;
                    return (
                      <div
                        class="items-center gap-1"
                        classList={{
                          flex: rowIdx() === 0,
                          "hidden group-hover/workspace-switcher:flex group-focus-within/workspace-switcher:flex":
                            rowIdx() > 0,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          class="font-mono text-[0.7rem] leading-none text-fg-3 select-none w-3 shrink-0"
                        >
                          {isLast() ? "└─" : "├─"}
                        </span>
                        <div class="grid grid-cols-[repeat(3,auto)] gap-1">
                          <For each={row}>
                            {(item) => {
                              const theme = () => tileTheme(item.id);
                              const active = () => store.activeId() === item.id;
                              const unread = () => store.isUnread(item.id);
                              const agentState = () =>
                                item.info.meta.agent?.state;
                              const borderClass = () =>
                                agentBorderClass(agentState());
                              return (
                                <button
                                  type="button"
                                  data-testid="workspace-switcher-pill"
                                  data-terminal-id={item.id}
                                  data-active={active() ? "" : undefined}
                                  data-unread={unread() ? "" : undefined}
                                  data-agent-state={agentState()}
                                  class={`pointer-events-auto flex items-center gap-1 px-2 h-6 rounded-full text-xs cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] whitespace-nowrap ${borderClass()}`}
                                  classList={{
                                    "pill-border pill-border-active":
                                      active() && !agentState(),
                                    "pill-glow-inner":
                                      active() && !!agentState(),
                                    "hover:ring-1 hover:ring-edge/60":
                                      !active() && !agentState(),
                                  }}
                                  style={{
                                    "background-color": theme().bg,
                                    color: theme().fg,
                                    "--card-color": repoAccent(item.info),
                                  }}
                                  onClick={() => props.onSelect(item.id)}
                                  title={item.info.meta.cwd}
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
                                  <span
                                    class="truncate min-w-0"
                                    style={{ color: branchAccent(item.info) }}
                                  >
                                    {item.label}
                                  </span>
                                  <Show when={item.suffix}>
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

              <Show when={group.items.length > ITEMS_PER_ROW}>
                <span
                  data-testid="workspace-switcher-more"
                  class="ml-4 text-[0.55rem] font-mono text-fg-3 leading-none group-hover/workspace-switcher:hidden group-focus-within/workspace-switcher:hidden"
                >
                  ▾ +{group.items.length - ITEMS_PER_ROW}
                </span>
              </Show>
            </div>
          );
        }}
      </For>
    </>
  );
};

export default CollapsedWorkspaceSwitcher;
