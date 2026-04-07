/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Sidebar entries and Mission Control cards. */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import ClaudeIndicator from "./ClaudeIndicator";
import ActivityGraph from "./ActivityGraph";
import Tip from "./Tip";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import type { TerminalDisplayInfo } from "./terminalDisplay";

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
                class={`flex items-center gap-1 ${detailClass()} text-fg-3 truncate`}
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

          {/* Claude indicator + activity sparkline (single row) */}
          <Show when={info().meta.claude || info().activityHistory.length > 0}>
            <div
              class="flex items-center gap-1.5 min-w-0 mt-1"
              classList={{
                "mt-auto": mode() === "readonly",
              }}
            >
              <Show when={info().meta.claude}>
                {(claude) => <ClaudeIndicator state={claude().state} />}
              </Show>
              <Show when={info().activityHistory.length > 0}>
                <div class="ml-auto w-16 shrink-0">
                  <ActivityGraph samples={info().activityHistory} />
                </div>
              </Show>
            </div>
          </Show>

          {/* Foreground process / title — own line, always spaced from above */}
          <Show when={info().meta.foreground}>
            {(fg) => (
              <div
                class="text-xs text-fg-3 font-mono truncate min-w-0 mt-1"
                data-testid="process-name"
                title={fg().title ?? fg().name}
              >
                {fg().title ?? fg().name}
              </div>
            )}
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
