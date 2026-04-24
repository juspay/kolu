/** Terminal metadata for the canvas tile title bar — two rows:
 *
 *    Row 1: name [suffix] [worktree] [foreground] [agent progress]
 *    Row 2: branch [PR icon checks #N title]
 *
 *  The mobile pull-handle has its own one-row layout — see
 *  `TerminalMetaCompact`. Reusing one component across both was an
 *  abstraction that complected mount-site context with rendering
 *  decisions; the two layouts are different enough to warrant
 *  separate components, with shared bits (skeleton, agent progress)
 *  exported below for reuse. */

import { type Component, Show } from "solid-js";
import { prValue, prUnavailableSource } from "kolu-common/pr";
import ChecksIndicator from "./ChecksIndicator";
import Tip from "../ui/Tip";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import { PrUnavailableButton } from "./PrUnavailablePopover";
import { copyTextWithToast } from "./clipboard";
import type { TerminalDisplayInfo } from "./terminalDisplay";

const TerminalMeta: Component<{
  info: TerminalDisplayInfo | undefined;
}> = (props) => {
  const i = () => props.info;
  return (
    <Show when={i()} fallback={<TerminalMetaSkeleton />}>
      {(info) => (
        <>
          {/* Name row — `name suffix [worktree-icon] [fg-title] [progress]`.
           *  Sub-count lives on the title-bar split toggle (one source
           *  of truth for "this tile has children"); the agent task
           *  progress bar owns the right slot when an agent is running.
           *  The agent state itself (Thinking/Tool use/Waiting) is
           *  shown by the title bar's agent indicator button — no
           *  separate agent row here. CWD is implicit (tooltip on the
           *  repo name) — visible space is reserved for the OSC 2
           *  process title. */}
          <div class="flex items-center gap-1.5 min-h-7 text-sm font-medium min-w-0">
            <NameSpan info={info()} />
            <Show when={info().key.suffix}>
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
            <Show when={info().meta.git?.isWorktree}>
              <WorktreeBadge />
            </Show>
            {/* Foreground process title — OSC 2 string when present.
             *  Replaces what used to be the cwd slot; cwd is now a
             *  tooltip on the repo name. `flex-1` so it fills until
             *  the progress bar (when shown) eats its right edge. */}
            <Show when={info().meta.foreground}>
              {(fg) => (
                <span
                  data-testid="process-name"
                  class="text-xs text-fg-3 truncate min-w-0 flex-1"
                  title={fg().title ?? fg().name}
                >
                  {fg().title ?? fg().name}
                </span>
              )}
            </Show>
            <Show when={info().meta.agent?.taskProgress}>
              {(tp) => (
                <AgentTaskProgress
                  completed={tp().completed}
                  total={tp().total}
                />
              )}
            </Show>
          </div>

          {/* Branch + PR — combined row. PR (if present) follows inline:
           *  state icon, checks indicator, linked #N, truncated title. */}
          <Show
            when={info().meta.git}
            fallback={
              <div data-testid="terminal-meta-branch" class="text-xs text-fg-2">
                {"\u00A0"}
              </div>
            }
          >
            {(git) => (
              <div class="flex items-center gap-1.5 min-w-0 text-xs">
                <Tip label="Copy branch name">
                  <button
                    type="button"
                    data-testid="terminal-meta-branch"
                    aria-label={`Copy branch ${git().branch} to clipboard`}
                    class="appearance-none bg-transparent border-0 p-0 text-left [font:inherit] truncate shrink-0 max-w-[16ch] cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                    style={{ color: info().branchColor }}
                    classList={{ "text-fg-2": !info().branchColor }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyTextWithToast(git().branch, {
                        success: "Copied branch name to clipboard",
                        failure: "Failed to copy branch name",
                      });
                    }}
                    onDblClick={(e) => e.stopPropagation()}
                  >
                    {git().branch}
                  </button>
                </Tip>
                <Show when={prValue(info().meta.pr)}>
                  {(pr) => (
                    <span
                      class="flex items-center gap-1 text-fg-2 truncate min-w-0"
                      data-testid="terminal-meta-pr"
                      title={`#${pr().number} ${pr().title}`}
                    >
                      <PrStateIcon state={pr().state} class="w-3 h-3" />
                      <Show when={pr().checks}>
                        {(checks) => <ChecksIndicator status={checks()} />}
                      </Show>
                      <a
                        href={pr().url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:text-accent shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{pr().number}
                      </a>
                      <span class="truncate">{pr().title}</span>
                    </span>
                  )}
                </Show>
                <Show when={prUnavailableSource(info().meta.pr)}>
                  {(source) => (
                    <PrUnavailableButton
                      source={source()}
                      testId="terminal-meta-pr-unavailable"
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </>
      )}
    </Show>
  );
};

/** Mobile pull-handle one-row variant — repo + branch + #PR inline.
 *  Mirrors what the pill tree shows for a focused terminal; the full
 *  branch/PR/foreground details live in the chrome sheet that the
 *  pull-handle opens. */
export const TerminalMetaCompact: Component<{
  info: TerminalDisplayInfo | undefined;
}> = (props) => {
  const i = () => props.info;
  return (
    <Show when={i()} fallback={<TerminalMetaSkeleton />}>
      {(info) => (
        <div class="flex items-center gap-1.5 min-h-7 text-sm font-medium min-w-0">
          <NameSpan info={info()} />
          <Show when={info().meta.git?.isWorktree}>
            <WorktreeBadge />
          </Show>
          <Show when={info().meta.git}>
            {(git) => (
              <span
                data-testid="terminal-meta-branch"
                class="text-xs truncate min-w-0"
                style={{ color: info().branchColor }}
                classList={{ "text-fg-2": !info().branchColor }}
              >
                {git().branch}
              </span>
            )}
          </Show>
          {/* Anchor stops propagation so a tap on the PR doesn't toggle
           *  the enclosing Drawer.Trigger. */}
          <Show when={prValue(info().meta.pr)}>
            {(pr) => (
              <a
                data-testid="terminal-meta-pr-compact"
                href={pr().url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs font-mono text-fg-3 hover:text-accent shrink-0"
                title={`#${pr().number} ${pr().title}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                #{pr().number}
              </a>
            )}
          </Show>
          <Show when={prUnavailableSource(info().meta.pr)}>
            {(source) => (
              <PrUnavailableButton
                source={source()}
                testId="terminal-meta-pr-unavailable-compact"
              />
            )}
          </Show>
          <Show when={info().meta.agent?.taskProgress}>
            {(tp) => (
              <AgentTaskProgress
                completed={tp().completed}
                total={tp().total}
              />
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

const NameSpan: Component<{ info: TerminalDisplayInfo }> = (props) => (
  <span
    data-testid="terminal-meta-name"
    class="truncate shrink-0 max-w-[20ch]"
    style={{ color: props.info.repoColor }}
    title={props.info.meta.cwd}
  >
    {props.info.name}
  </span>
);

const WorktreeBadge: Component = () => (
  <span
    data-testid="worktree-indicator"
    class="text-fg-3 shrink-0"
    title="Worktree"
  >
    <WorktreeIcon />
  </span>
);

const AgentTaskProgress: Component<{ completed: number; total: number }> = (
  props,
) => (
  <div
    data-testid="agent-task-progress"
    class="ml-auto flex items-center gap-1.5 shrink-0 w-24"
    title={`${props.completed}/${props.total} tasks completed`}
  >
    <div class="flex-1 h-1 rounded-full bg-fg/10 overflow-hidden">
      <div
        class="h-full rounded-full bg-busy transition-all duration-300"
        style={{
          width: `${props.total > 0 ? (props.completed / props.total) * 100 : 0}%`,
        }}
      />
    </div>
    <span class="text-[0.65rem] text-fg-2 tabular-nums">
      {props.completed}/{props.total}
    </span>
  </div>
);

const TerminalMetaSkeleton: Component = () => (
  <div class="animate-pulse space-y-1.5">
    <div class="h-3.5 w-24 bg-surface-2 rounded" />
    <div class="h-3 w-16 bg-surface-2 rounded" />
  </div>
);

export default TerminalMeta;
