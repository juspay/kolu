import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PlusIcon } from "../../ui/Icons";
import { agentBorderClass } from "./chrome";
import { branchAccent, repoAccent } from "./identity";
import type { WorkspaceSwitcherRepoGroup } from "./model";

const ITEMS_PER_ROW = 3;

/** Collapsed desktop switcher: a miniaturised form of the search-panel
 *  card vocabulary — same rectangle shape, same border treatment, same
 *  agent-state ring, just compressed for the chrome bar. The repo color
 *  lives in the heading bar; per-card eyebrows would be too dense at
 *  this scale. Hover/focus reveals the full panel beneath. */
const CollapsedWorkspaceSwitcher: Component<{
  groups: WorkspaceSwitcherRepoGroup[];
  onCreate: () => void;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();

  return (
    <>
      <button
        type="button"
        data-testid="workspace-switcher-new"
        class="pointer-events-auto group/new flex items-center justify-center w-7 h-7 mt-3 rounded-md shrink-0 cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        onClick={props.onCreate}
        aria-label="New terminal"
        title="New terminal"
      >
        <PlusIcon class="w-3.5 h-3.5 transition-transform duration-200 group-hover/new:rotate-90" />
      </button>

      <For each={props.groups}>
        {(group) => {
          const visible = () => group.items.slice(0, ITEMS_PER_ROW);
          const overflow = () =>
            Math.max(0, group.items.length - ITEMS_PER_ROW);
          return (
            <div class="pointer-events-auto flex flex-col items-start gap-1.5 min-w-0">
              <div class="flex items-center gap-1.5 max-w-[18ch] min-w-0 pl-0.5">
                <span
                  aria-hidden="true"
                  class="w-[2px] h-3 rounded-full shrink-0"
                  style={{ "background-color": group.color }}
                />
                <div
                  data-testid="workspace-switcher-compact-repo"
                  class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate"
                  style={{ color: group.color }}
                  title={group.repoName}
                >
                  {group.repoName}
                </div>
                <Show when={overflow() > 0}>
                  <span
                    data-testid="workspace-switcher-more"
                    class="font-mono text-[0.55rem] tabular-nums leading-none text-fg-3 shrink-0"
                    title={`${overflow()} more terminals`}
                  >
                    +{overflow()}
                  </span>
                </Show>
              </div>

              <div
                class="flex flex-row gap-1 pl-2 border-l-[1px]"
                style={{
                  "border-color": `color-mix(in oklch, ${group.color} 22%, transparent)`,
                }}
              >
                <For each={visible()}>
                  {(item) => {
                    const active = () => store.activeId() === item.id;
                    const unread = () => store.isUnread(item.id);
                    const agentState = () => item.info.meta.agent?.state;
                    const borderClass = () => agentBorderClass(agentState());
                    return (
                      <button
                        type="button"
                        data-testid="workspace-switcher-pill"
                        data-terminal-id={item.id}
                        data-active={active() ? "" : undefined}
                        data-unread={unread() ? "" : undefined}
                        data-agent-state={agentState()}
                        class={`pointer-events-auto relative flex items-center gap-1.5 px-2 h-6 rounded-md border text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 max-w-[20ch] whitespace-nowrap ${borderClass()}`}
                        classList={{
                          "border-accent/70 bg-surface-2":
                            active() && !agentState(),
                          "pill-glow-inner": active() && !!agentState(),
                          "border-edge/60 bg-surface-0/60 hover:bg-surface-2/70 hover:border-edge-bright/70":
                            !active() && !agentState(),
                          "border-transparent bg-surface-0/60":
                            !active() && !!agentState(),
                        }}
                        style={{
                          "--card-color": repoAccent(item.info),
                          "--pill-border-radius": "calc(0.375rem + 2px)",
                        }}
                        onClick={() => props.onSelect(item.id)}
                        title={item.info.meta.cwd}
                      >
                        <Show when={unread()}>
                          <span
                            class="absolute -top-1 -right-1 inline-flex h-2 w-2"
                            aria-hidden="true"
                          >
                            <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
                          </span>
                        </Show>
                        <span
                          class="truncate min-w-0 font-medium"
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
    </>
  );
};

export default CollapsedWorkspaceSwitcher;
