/** Pull-request presentation carried on a dock row — the state icon, the
 *  checks dot, and the tooltip that names which gate is red.
 *
 *  It rides in the ROW package rather than in the app because the PR badge is
 *  part of what a dock row IS: a fleet mirror that got the pip, the words, the
 *  annotation and the recency but had to re-draw the PR pip would be inventing
 *  exactly the thing this package exists to stop it inventing. The forge
 *  vocabulary it speaks (`anyforge/schemas`) costs a consumer nothing it does
 *  not already install — `@kolu/padi-client`, the surface a mirror dials,
 *  already names it — so leanness is not on the other side of this trade.
 *
 *  The GLYPHS live here too, and this is their only home in the repo: nothing
 *  else drew them. kolu's other PR surfaces (tile title bar, workspace
 *  switcher, close-confirm) import them back from this package, which is the
 *  same shape as the dock reading `StatePip` out of `@kolu/solid-statepip`. */

import type { CheckStatus, PrInfo } from "anyforge/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { prTooltip } from "./prTooltip.ts";

const GitMergeIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005v.004zm.45 1.9a2.25 2.25 0 1 0-1.95.218v5.256a2.25 2.25 0 1 0 1.5 0V7.121A5.69 5.69 0 0 0 9.5 9.5a3.5 3.5 0 0 0 3.5-3.5V5.314a2.25 2.25 0 1 0-1.5 0V6a2 2 0 0 1-2 2A4.19 4.19 0 0 1 5.45 5.154zM4.25 12a.75.75 0 1 1 0 1.501.75.75 0 0 1 0-1.5zM12.25 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
  </svg>
);

const GitPullRequestClosedIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.25 2.25 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75zm-2.03-5.28a.751.751 0 0 1 1.042-.018.751.751 0 0 1 .018 1.042L10.56 3.5l1.22 1.256a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9.464 4.53a.75.75 0 0 1 0-1.06zM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
  </svg>
);

const GitPullRequestIcon: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class ?? "w-3.5 h-3.5"}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.25 2.25 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354zM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0z" />
  </svg>
);

const prStateConfig: Record<
  PrInfo["state"],
  { icon: Component<{ class?: string }>; color: string }
> = {
  open: { icon: GitPullRequestIcon, color: "text-ok" },
  closed: { icon: GitPullRequestClosedIcon, color: "text-danger" },
  merged: { icon: GitMergeIcon, color: "text-merged" },
};

/** PR state icon — green for open, purple for merged, red for closed. */
export const PrStateIcon: Component<{
  state: PrInfo["state"];
  class?: string;
}> = (props) => {
  const cfg = () => prStateConfig[props.state];
  return (
    <span class={`${cfg().color} shrink-0`}>
      <Dynamic component={cfg().icon} class={props.class ?? "w-3.5 h-3.5"} />
    </span>
  );
};

/** Colored dot indicating CI check status (pass/pending/fail). */
export const ChecksIndicator: Component<{ status: CheckStatus }> = (props) => (
  <span
    class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
    classList={{
      "bg-ok": props.status === "pass",
      "bg-warning animate-pulse": props.status === "pending",
      "bg-danger": props.status === "fail",
    }}
  />
);

/** Inline PR pip — a real link so modified click and the context menu retain
 *  browser semantics. The caller owns its position in the row.
 *
 *  Takes the PR VALUE, not the terminal record: resolving which arm's PR a row
 *  shows (`activePr`) is the call site's read, and the pip renders what it is
 *  handed. `null` renders nothing, which is how a row without a PR keeps its
 *  line-2 geometry without a placeholder. */
export const PrPip: Component<{ pr: PrInfo | null }> = (props) => (
  <Show when={props.pr}>
    {(p) => (
      <a
        href={p().url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="dock-row-pr-pip"
        class="flex items-center gap-1 text-fg-3 hover:text-fg transition-colors shrink-0"
        title={prTooltip(p())}
        onClick={(event) => event.stopPropagation()}
      >
        <PrStateIcon state={p().state} class="w-3 h-3" />
        <Show when={p().checks}>
          {(checks) => <ChecksIndicator status={checks()} />}
        </Show>
      </a>
    )}
  </Show>
);
