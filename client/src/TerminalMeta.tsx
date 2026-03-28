/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Sidebar entries and Mission Control cards. */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import ClaudeIndicator from "./ClaudeIndicator";
import ActivityGraph from "./ActivityGraph";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import type { ColoredTerminalMeta as ColoredMeta } from "./path";
import type { ActivitySample } from "./useTerminals";

/** "normal" = interactive (compact text, PR links). "readonly" = display-only (larger text, no links). */
export type TerminalMetaMode = "normal" | "readonly";

const TerminalMeta: Component<{
  colored: ColoredMeta | undefined;
  activityHistory: ActivitySample[];
  subCount?: number;
  mode?: TerminalMetaMode;
}> = (props) => {
  const mode = () => props.mode ?? "normal";
  const nameClass = () =>
    mode() === "normal" ? "text-sm font-medium" : "text-base font-semibold";
  const detailClass = () => (mode() === "normal" ? "text-xs" : "text-sm");
  const c = () => props.colored;

  return (
    <>
      {/* Name row */}
      <div class={`flex items-center gap-1.5 ${nameClass()} truncate`}>
        <Show when={c()}>
          {(colored) => (
            <span
              data-testid="terminal-meta-name"
              class="truncate"
              style={{ color: colored().repoColor }}
            >
              {colored().name}
            </span>
          )}
        </Show>
        <Show when={c()?.meta.git?.isWorktree}>
          <span
            data-testid="worktree-indicator"
            class="text-fg-3 shrink-0"
            title="Worktree"
          >
            <WorktreeIcon />
          </span>
        </Show>
        <Show when={(props.subCount ?? 0) > 0}>
          <span
            data-testid="sub-count"
            class="ml-auto text-[0.6rem] text-fg-3 bg-surface-2 px-1 rounded shrink-0"
          >
            +{props.subCount}
          </span>
        </Show>
      </div>

      {/* Branch */}
      <div
        data-testid="terminal-meta-branch"
        class={`${detailClass()} truncate`}
        title={c()?.meta.git?.branch}
        style={{ color: c()?.branchColor }}
        classList={{ "text-fg-2": !c()?.branchColor }}
      >
        {c()?.meta.git?.branch ?? "\u00A0"}
      </div>

      {/* PR info */}
      <Show when={c()?.meta.pr}>
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

      {/* Agent status + activity sparkline */}
      <Show when={c()?.meta.claude || props.activityHistory.length > 0}>
        <div class="flex items-center gap-1.5 mt-0.5">
          <Show when={c()?.meta.claude}>
            {(claude) => <ClaudeIndicator state={claude().state} />}
          </Show>
          <Show when={props.activityHistory.length > 0}>
            <div class="ml-auto">
              <ActivityGraph samples={props.activityHistory} />
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
};

export default TerminalMeta;
