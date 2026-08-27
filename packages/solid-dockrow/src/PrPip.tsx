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
 *  The GLYPHS are this package's too — `./forgeIcons`, a registry module beside
 *  this one, because nothing else in the repo drew them. kolu's other PR surfaces (tile title bar, workspace
 *  switcher, close-confirm) import them back from this package, which is the
 *  same shape as the dock reading `StatePip` out of `@kolu/solid-statepip`. */

import type { CheckStatus, PrInfo } from "anyforge/schemas";
import { type Component, Show } from "solid-js";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
} from "./forgeIcons.tsx";
import { Dynamic } from "solid-js/web";
import { prTooltip } from "./prTooltip.ts";

const prStateConfig: Record<
  PrInfo["state"],
  { icon: Component<{ class: string }>; color: string }
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
