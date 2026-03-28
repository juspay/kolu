/** Terminal metadata display — name, branch, PR, agent status, activity.
 *  Shared between Sidebar entries and Mission Control cards. */

import { type Component, type JSX, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import ClaudeIndicator from "./ClaudeIndicator";
import ActivityGraph from "./ActivityGraph";
import { PrStateIcon } from "./Icons";
import { cwdBasename } from "./path";
import type { TerminalMetadata } from "kolu-common";
import type { ActivitySample } from "./useTerminals";

const TerminalMeta: Component<{
  meta: TerminalMetadata | null | undefined;
  repoColor?: string;
  branchColor?: string;
  activityHistory: ActivitySample[];
  /** Size variant: "compact" for sidebar, "normal" for mission control cards. */
  size?: "compact" | "normal";
  /** Whether the PR number links to the PR URL. */
  linkPr?: boolean;
  /** Extra elements after the name (e.g. worktree icon, sub-count badge). */
  nameExtra?: JSX.Element;
}> = (props) => {
  const size = () => props.size ?? "compact";
  const nameClass = () =>
    size() === "compact" ? "text-sm font-medium" : "text-base font-semibold";
  const detailClass = () => (size() === "compact" ? "text-xs" : "text-sm");

  return (
    <>
      {/* Name row */}
      <div class={`flex items-center gap-1.5 ${nameClass()} truncate`}>
        <Show when={props.meta}>
          {(meta) => (
            <span
              data-testid="terminal-meta-name"
              class="truncate"
              style={{ color: props.repoColor }}
            >
              {meta().git?.repoName ?? cwdBasename(meta().cwd)}
            </span>
          )}
        </Show>
        {props.nameExtra}
      </div>

      {/* Branch */}
      <div
        data-testid="terminal-meta-branch"
        class={`${detailClass()} truncate`}
        title={props.meta?.git?.branch}
        style={{ color: props.branchColor }}
        classList={{ "text-fg-2": !props.branchColor }}
      >
        {props.meta?.git?.branch ?? "\u00A0"}
      </div>

      {/* PR info */}
      <Show when={props.meta?.pr}>
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
              when={props.linkPr}
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
      <Show when={props.meta?.claude || props.activityHistory.length > 0}>
        <div class="flex items-center gap-1.5 mt-0.5">
          <Show when={props.meta?.claude}>
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
