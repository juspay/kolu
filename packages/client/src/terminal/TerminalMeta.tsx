/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Dock entries and Mission Control cards. */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "../dock/ChecksIndicator";
import AgentIndicator from "../dock/AgentIndicator";
import ActivityGraph from "../dock/ActivityGraph";
import Tip from "../ui/Tip";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { AgentInfo } from "kolu-common";

/** "normal" = interactive (compact text, PR links). "readonly" = display-only (larger text, no links). */
export type TerminalMetaMode = "normal" | "readonly";

const TerminalMeta: Component<{
  info: TerminalDisplayInfo | undefined;
  mode?: TerminalMetaMode;
}> = (props) => {
  const mode = () => props.mode ?? "normal";
  const nameClass = () =>
    mode() === "normal" ? "text-sm font-medium" : "text-base font-semibold";
  const detailClass = () => (mode() === "normal" ? "text-xs" : "text-sm");
  const i = () => props.info;

  return (
    <Show when={i()} fallback={<TerminalMetaSkeleton />}>
      {(info) => (
        <>
          {/* Name row */}
          <div class={`flex items-center gap-1.5 ${nameClass()} truncate`}>
            <span
              data-testid="terminal-meta-name"
              class="truncate"
              style={{ color: info().repoColor }}
            >
              {info().name}
            </span>
            <Show when={info().meta.git}>
              {(git) => (
                <Show when={git().isWorktree}>
                  <span
                    data-testid="worktree-indicator"
                    class="text-fg-3 shrink-0"
                    title="Worktree"
                  >
                    <WorktreeIcon />
                  </span>
                </Show>
              )}
            </Show>
            <Show when={info().subCount > 0}>
              <span
                data-testid="sub-count"
                class="ml-auto text-[0.6rem] text-fg-2 bg-fg/10 px-1 rounded shrink-0"
              >
                +{info().subCount}
              </span>
            </Show>
          </div>

          {/* Branch — tooltip shows full name when truncated */}
          <Show
            when={info().meta.git}
            fallback={
              <div
                data-testid="terminal-meta-branch"
                class={`${detailClass()} text-fg-2`}
              >
                {"\u00A0"}
              </div>
            }
          >
            {(git) => (
              <Tip label={git().branch}>
                <div
                  data-testid="terminal-meta-branch"
                  class={`${detailClass()} truncate`}
                  style={{ color: info().branchColor }}
                  classList={{ "text-fg-2": !info().branchColor }}
                >
                  {git().branch}
                </div>
              </Tip>
            )}
          </Show>

          {/* PR info */}
          <Show when={info().meta.pr}>
            {(pr) => (
              <div
                class={`flex items-center gap-1 ${detailClass()} text-fg-2 truncate`}
                data-testid="terminal-meta-pr"
                title={`#${pr().number} ${pr().title}`}
              >
                <PrStateIcon state={pr().state} class="w-3 h-3" />
                <Show when={pr().checks}>
                  {(checks) => <ChecksIndicator status={checks()} />}
                </Show>
                <Show
                  when={mode() === "normal"}
                  fallback={<span class="shrink-0">#{pr().number}</span>}
                >
                  <a
                    href={pr().url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:text-accent shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    #{pr().number}
                  </a>
                </Show>
                <span class="truncate">{pr().title}</span>
              </div>
            )}
          </Show>

          {/* Agent indicator — own row when active. For Claude Code, the
           *  summary line carries the SDK-derived display title (custom title ›
           *  auto-summary › first prompt) so a glance at the card tells you
           *  _what_ the agent is working on, not just that it's working. */}
          <Show when={info().meta.agent}>
            {(agent) => (
              <div class="mt-1">
                <div class="flex items-center gap-1.5">
                  <AgentIndicator agent={agent()} />
                  <Show when={agent().taskProgress}>
                    {(tp) => (
                      <div
                        data-testid="agent-task-progress"
                        class="flex items-center gap-1.5 flex-1 min-w-0"
                        title={`${tp().completed}/${tp().total} tasks completed`}
                      >
                        <div class="flex-1 h-1 rounded-full bg-fg/10 min-w-8 overflow-hidden">
                          <div
                            class="h-full rounded-full bg-busy transition-all duration-300"
                            style={{
                              width: `${tp().total > 0 ? (tp().completed / tp().total) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span class="text-xs text-fg-2 tabular-nums shrink-0">
                          {tp().completed}/{tp().total}
                        </span>
                      </div>
                    )}
                  </Show>
                </div>
                <Show when={agent().summary}>
                  {(summary) => (
                    <div
                      data-testid="agent-summary"
                      class="text-xs text-fg-3 truncate mt-0.5"
                      title={summary()}
                    >
                      {summary()}
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>

          {/* Foreground process/title + activity sparkline (shared row) */}
          <Show
            when={info().meta.foreground || info().activityHistory.length > 0}
          >
            <div
              class="flex items-center gap-2 min-w-0 mt-1"
              classList={{
                "mt-auto": mode() === "readonly",
              }}
            >
              {/* Suppress the OSC 2 title when the agent summary row is
               *  already shown above — the two texts are near-duplicates
               *  (SDK summary vs agent's live activity indicator) and
               *  stacking them eats vertical space for no new information.
               *  `A && B` returns B when A is truthy, so `Show` narrows
               *  `fg` to the foreground value directly. */}
              <Show
                when={
                  !(info().meta.agent && info().meta.agent!.summary) &&
                  info().meta.foreground
                }
              >
                {(fg) => (
                  <span
                    class="text-xs text-fg-3 truncate min-w-0 flex-1"
                    data-testid="process-name"
                    title={fg().title ?? fg().name}
                  >
                    {fg().title ?? fg().name}
                  </span>
                )}
              </Show>
              <Show when={info().activityHistory.length > 0}>
                <div class="ml-auto w-16 shrink-0">
                  <ActivityGraph samples={info().activityHistory} />
                </div>
              </Show>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
};

/** Skeleton placeholder shown while metadata query is pending. */
const TerminalMetaSkeleton: Component = () => (
  <div class="animate-pulse space-y-1.5">
    <div class="h-3.5 w-24 bg-surface-2 rounded" />
    <div class="h-3 w-16 bg-surface-2 rounded" />
  </div>
);

export default TerminalMeta;
