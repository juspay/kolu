/** Tiny inline icons rendered on every dock row so the row scans as
 *  "has a PR, has an agent, has sub-terminals" without unfolding the
 *  full chrome.
 *
 *  Each pip lives in a **fixed-width slot** so the icon columns line
 *  up vertically across rows — scanning the dock you can tell which
 *  rows have a PR by looking at one column, which have an agent at
 *  the next, etc. Empty slots collapse to a blank cell of the same
 *  width rather than pulling other icons leftward.
 *
 *  Pips are presence-only — no number, no label, no token count. The
 *  bucket dot already encodes agent state (awaiting / working /
 *  idle), so the agent pip carries only the agent kind (Claude Code
 *  / Codex / OpenCode logo).
 *
 *  The PR pip is a link to `pr.url` — clicking opens the PR on
 *  GitHub directly. `stopPropagation` on the inner click keeps the
 *  dock row's `activate` handler from firing as well. Tooltip
 *  combines the PR label and the live checks verdict so a single
 *  hover surfaces `#123 Title — Checks: pending`. */

import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import {
  type GitHubCheckStatus,
  type GitHubPrInfo,
  prLabel,
  prValue,
} from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { agentIcons } from "../../ui/agentDisplay";
import { PrStateIcon } from "../../ui/Icons";
import { SubCountChip } from "./SubCountChip";

const CHECKS_LABEL: Record<GitHubCheckStatus, string> = {
  pass: "Checks: pass",
  pending: "Checks: pending",
  fail: "Checks: fail",
};

function prTooltip(pr: GitHubPrInfo): string {
  const checks = pr.checks ? ` — ${CHECKS_LABEL[pr.checks]}` : "";
  return `${prLabel(pr)}${checks}`;
}

/** Fixed-width slot wrapper — children right-align inside so the
 *  rendered icons sit flush against the *next* slot's left edge and
 *  the columns visually align across rows regardless of which slots
 *  are populated. */
const Slot: Component<{
  /** Tailwind width utility (`w-6`, `w-7`, …). */
  width: string;
  children: unknown;
}> = (props) => (
  <span class={`${props.width} flex items-center justify-end gap-1 shrink-0`}>
    {props.children as never}
  </span>
);

export const RowIcons: Component<{
  meta: TerminalMetadata;
  info: TerminalDisplayInfo;
}> = (props) => {
  const pr = (): GitHubPrInfo | null => prValue(props.meta.pr);
  return (
    <>
      <Slot width="w-7">
        <Show when={pr()}>
          {(p) => (
            <a
              href={p().url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="dock-row-pr-pip"
              class="flex items-center gap-1 text-fg-3 hover:text-fg transition-colors"
              title={prTooltip(p())}
              onClick={(e) => e.stopPropagation()}
            >
              <PrStateIcon state={p().state} class="w-3 h-3" />
              <Show when={p().checks}>
                {(checks) => <ChecksIndicator status={checks()} />}
              </Show>
            </a>
          )}
        </Show>
      </Slot>
      <Slot width="w-4">
        <Show when={props.meta.agent}>
          {(agent) => <AgentPip agent={agent()} />}
        </Show>
      </Slot>
      <Slot width="w-7">
        <Show when={props.info.subCount > 0}>
          <SubCountChip
            count={props.info.subCount}
            active={false}
            testId="dock-sub-count"
          />
        </Show>
      </Slot>
    </>
  );
};

const AgentPip: Component<{ agent: AgentInfo }> = (props) => {
  const Icon = () => agentIcons[props.agent.kind];
  return (
    <span
      class="shrink-0 text-fg-3"
      data-testid="dock-row-agent-pip"
      data-agent-kind={props.agent.kind}
      title={props.agent.kind}
    >
      <Dynamic component={Icon()} class="w-3 h-3" />
    </span>
  );
};
