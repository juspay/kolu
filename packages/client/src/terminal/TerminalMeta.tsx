/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Sidebar entries and Mission Control cards. */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import AgentIndicator from "./AgentIndicator";
import ActivityGraph from "./ActivityGraph";
import Tip from "../ui/Tip";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { AgentInfo } from "kolu-common";
import { shortenCwd } from "../path";

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
          {/* Name row — sub-count moved to the title-bar split toggle
           *  (one source of truth for "this tile has children"); the
           *  activity sparkline takes that right slot so the title bar
           *  reads name → activity → window controls in a single line. */}
          <div class={`flex items-center gap-1.5 ${nameClass()} min-w-0`}>
            <span
              data-testid="terminal-meta-name"
              class="truncate min-w-0"
              style={{ color: info().repoColor }}
            >
              {info().name}
            </span>
            <Show when={info().meta.displaySuffix}>
              {(suffix) => (
                <span
                  data-testid="terminal-meta-suffix"
                  class="font-mono text-xs text-fg-3 tabular-nums shrink-0"
                  title="Identifier — distinguishes terminals that share repo + branch (or cwd)"
                >
                  {suffix()}
                </span>
              )}
            </Show>
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
            <Show when={info().meta.cwd}>
              {(cwd) => (
                <span
                  data-testid="terminal-meta-cwd"
                  class="text-xs font-mono text-fg-3 truncate min-w-0"
                  title={cwd()}
                >
                  {shortenCwd(cwd())}
                </span>
              )}
            </Show>
            <Show when={info().activityHistory.length > 0}>
              <div class="ml-auto w-16 shrink-0">
                <ActivityGraph samples={info().activityHistory} />
              </div>
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

          {/* Foreground process/title row — activity sparkline lives on
           *  the name row now (item #5), so this row carries only the
           *  OSC 2 process title when present. Suppressed when the agent
           *  summary row above already shows a near-duplicate string, or
           *  when the title is just the cwd (already displayed on row 1). */}
          <Show
            when={
              !(info().meta.agent && info().meta.agent!.summary) &&
              info().meta.foreground
            }
          >
            {(fg) => {
              const text = () => fg().title ?? fg().name;
              const isCwd = () => {
                const cwd = info().meta.cwd;
                if (!cwd) return false;
                const t = text();
                return t === cwd || t === shortenCwd(cwd);
              };
              return (
                <Show when={!isCwd()}>
                  <div
                    class="flex items-center gap-2 min-w-0 mt-1"
                    classList={{
                      "mt-auto": mode() === "readonly",
                    }}
                  >
                    <span
                      class="text-xs text-fg-3 truncate min-w-0 flex-1"
                      data-testid="process-name"
                      title={text()}
                    >
                      {text()}
                    </span>
                  </div>
                </Show>
              );
            }}
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
