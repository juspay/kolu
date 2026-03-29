/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Sidebar entries and Mission Control cards. */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import ClaudeIndicator from "./ClaudeIndicator";
import ActivityGraph from "./ActivityGraph";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import type { TerminalDisplayInfo } from "./path";

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
    <>
      {/* Name row */}
      <div class={`flex items-center gap-1.5 ${nameClass()} truncate`}>
        <Show when={i()}>
          {(info) => (
            <span
              data-testid="terminal-meta-name"
              class="truncate"
              style={{ color: info().repoColor }}
            >
              {info().name}
            </span>
          )}
        </Show>
        <Show when={i()?.meta.git?.isWorktree}>
          <span
            data-testid="worktree-indicator"
            class="text-fg-3 shrink-0"
            title="Worktree"
          >
            <WorktreeIcon />
          </span>
        </Show>
        <Show when={(i()?.subCount ?? 0) > 0}>
          <span
            data-testid="sub-count"
            class="ml-auto text-[0.6rem] text-fg-3 bg-surface-2 px-1 rounded shrink-0"
          >
            +{i()!.subCount}
          </span>
        </Show>
      </div>

      {/* Branch */}
      <div
        data-testid="terminal-meta-branch"
        class={`${detailClass()} truncate`}
        title={i()?.meta.git?.branch}
        style={{ color: i()?.branchColor }}
        classList={{ "text-fg-2": !i()?.branchColor }}
      >
        {i()?.meta.git?.branch ?? "\u00A0"}
      </div>

      {/* PR info */}
      <Show when={i()?.meta.pr}>
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
      <Show when={i()?.meta.claude || (i()?.activityHistory.length ?? 0) > 0}>
        <div class="flex items-center gap-1.5 mt-0.5">
          <Show when={i()?.meta.claude}>
            {(claude) => <ClaudeIndicator state={claude().state} />}
          </Show>
          <Show when={(i()?.activityHistory.length ?? 0) > 0}>
            <div class="ml-auto">
              <ActivityGraph samples={i()!.activityHistory} />
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
};

export default TerminalMeta;
