/** Terminal metadata for the canvas tile title bar — two rows:
 *
 *    Row 1: name [suffix] [worktree] [foreground] [agent progress]
 *    Row 2: annotation [PR icon checks #N title]
 *
 *  Row 2 is the *annotation slot* (supplant rule): intent line-1 if
 *  the user set one, else the git branch name, else empty. Clicking
 *  the slot always opens the intent editor — there's no separate
 *  glyph chip, so the slot is the canvas tile's sole intent
 *  affordance.
 *
 *  The mobile pull-handle has its own one-row layout — see
 *  `TerminalMetaCompact`. */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import { StatePip } from "@kolu/solid-statepip";
import { TITLE_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { prValue } from "anyforge/schemas";
import { prUnavailableSource, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { IntentMarkdownInline } from "../intent/IntentMarkdown";
import { annotationLine } from "../intent/text";
import { agentWorkflow } from "../ui/agentDisplay";
import { SLEEPING_RECEDE_CLASS } from "../ui/chromeSpacing";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import Tip from "../ui/Tip";
import { encActiveHost } from "../wire";
import ChecksIndicator from "./ChecksIndicator";
import { PrUnavailableButton } from "./PrUnavailablePopover";
import { prTooltip } from "./prTooltip";
import { useStatePip } from "./statePipBind";
import { pairDisplayRow, type TerminalDisplayInfo } from "./terminalDisplay";

const TerminalMeta: Component<{
  info: TerminalDisplayInfo | undefined;
  /** The LIVE per-terminal record — read straight from `getMetadata(id)`, the
   *  fine-grained store proxy. Every live fact on the title bar (pr, agent,
   *  foreground, intent, git) reads off this — crucially the fast-churning ones
   *  (pr / agent / foreground) that the `displayInfos` snapshot could not keep
   *  fresh (git / cwd DO invalidate that memo, so they were never stale there;
   *  reading them live too just keeps one source of truth). So the header tracks
   *  the same leaf the dock does and can never lag it. `info` carries only the
   *  display decorations (colors + identity key). */
  meta: TerminalMetadata | undefined;
  /** Terminal id — required for activity / EF2 finished motion folds. */
  terminalId: TerminalId;
  /** True when this terminal has unseen agent activity. Drives the
   *  leading state pip's attention escalation exactly as the dock row
   *  does, so the title and the dock can't disagree on what's loud.
   *  Sourced from view-state at the call site (`store.isUnread(id)`). */
  unread: boolean;
  /** Open the intent editor for this terminal. Wired in `App.tsx` to
   *  `intentEditor.openTerminal(id)`. */
  onOpenIntent: () => void;
}> = (props) => {
  const view = createMemo(() => pairDisplayRow(props.info, props.meta));
  return (
    <Show when={view()} fallback={<TerminalMetaSkeleton />}>
      {(v) => {
        // T1: brand mark lives once on StatePip; AgentIndicator is words only.
        const pip = useStatePip(
          encActiveHost,
          () => props.terminalId,
          () => v().meta,
          () => props.unread,
        );
        // Sleeping recedes on the title the same way dock rows do
        // (`SLEEPING_RECEDE_CLASS`). Applied per row (not a contents-wrapper):
        // opacity does not inherit through `display: contents` into the
        // canvas title grid.
        return (
          <>
            {/* Name row — T1: identity StatePip leads (app-icon position),
             *  then repo name / suffix / worktree / fg / progress. */}
            <div
              class="col-start-1 row-start-1 flex items-center gap-1.5 min-h-7 text-sm font-medium min-w-0"
              classList={{ [SLEEPING_RECEDE_CLASS]: pip().sleeping }}
              data-sleeping={pip().sleeping ? "" : undefined}
            >
              {/* Always mount the shared pip — binder handles sleeping
               *  moonlit + identity even without a live activeArm. */}
              <StatePip {...pip()} class={TITLE_PIP_BOX} />
              <NameSpan info={v().info} meta={v().meta} />
              <Show when={v().info.key.suffix}>
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
              <Show when={v().meta.git?.isWorktree}>
                <WorktreeBadge />
              </Show>
              {/* Foreground process title — OSC 2 string when present.
               *  Replaces what used to be the cwd slot; cwd is now a
               *  tooltip on the repo name. `flex-1` so it fills until
               *  the progress bar (when shown) eats its right edge. */}
              <Show when={activeArm(v().meta)?.foreground}>
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
              <Show when={agentWorkflow(activeArm(v().meta)?.agent)}>
                {(wf) => (
                  <AgentWorkflowBadge name={wf().name} agents={wf().agents} />
                )}
              </Show>
              <Show when={activeArm(v().meta)?.agent?.taskProgress}>
                {(tp) => (
                  <AgentTaskProgress
                    completed={tp().completed}
                    total={tp().total}
                  />
                )}
              </Show>
            </div>

            {/* Annotation row (supplant rule) + PR — no identity pip here
             *  (T1: brand mark appears once, on line 1). Sleeps with the name
             *  row so a dormant tile recedes on both chrome lines. */}
            <div
              class="col-start-1 col-span-2 row-start-2 flex items-center gap-1.5 min-w-0 text-xs"
              classList={{ [SLEEPING_RECEDE_CLASS]: pip().sleeping }}
            >
              <Tip label={v().meta.intent ? "Edit intent" : "Set intent"}>
                <button
                  type="button"
                  data-testid="terminal-meta-branch"
                  aria-label={
                    v().meta.intent
                      ? "Edit terminal intent"
                      : "Set terminal intent"
                  }
                  class="appearance-none bg-transparent border-0 p-0 text-left [font:inherit] truncate min-w-0 cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                  style={{ color: v().info.annotationColor }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onOpenIntent();
                  }}
                  onDblClick={(e) => e.stopPropagation()}
                >
                  <IntentMarkdownInline
                    markdown={annotationLine(
                      v().meta.intent,
                      v().meta.git?.branch ?? "—",
                    )}
                  />
                </button>
              </Tip>
              <Show when={activeArm(v().meta)}>
                {(active) => (
                  <>
                    <Show when={prValue(active().pr)}>
                      {(pr) => (
                        <span
                          class="flex items-center gap-1 text-fg-2 truncate min-w-0"
                          data-testid="terminal-meta-pr"
                          title={prTooltip(pr())}
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
                    <Show when={prUnavailableSource(active().pr)}>
                      {(source) => (
                        <PrUnavailableButton
                          source={source()}
                          testId="terminal-meta-pr-unavailable"
                        />
                      )}
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </>
        );
      }}
    </Show>
  );
};

/** Mobile pull-handle one-row variant — repo + branch + #PR inline.
 *  Mirrors what the workspace switcher shows for a focused terminal; the full
 *  branch/PR/foreground details live in the chrome sheet that the
 *  pull-handle opens. */
export const TerminalMetaCompact: Component<{
  info: TerminalDisplayInfo | undefined;
  /** The LIVE per-terminal record — see `TerminalMeta`. Every fast fact
   *  (pr, agent, intent, git) reads off this, never off a display-info
   *  snapshot. */
  meta: TerminalMetadata | undefined;
}> = (props) => {
  const view = createMemo(() => pairDisplayRow(props.info, props.meta));
  return (
    <Show when={view()} fallback={<TerminalMetaSkeleton />}>
      {(v) => (
        <div class="flex items-center gap-1.5 min-h-7 text-sm font-medium min-w-0">
          <NameSpan info={v().info} meta={v().meta} />
          <Show when={v().meta.git?.isWorktree}>
            <WorktreeBadge />
          </Show>
          <Show when={v().meta.intent ?? v().meta.git?.branch}>
            <span
              data-testid="terminal-meta-branch"
              class="text-xs truncate min-w-0"
              style={{ color: v().info.annotationColor }}
            >
              <IntentMarkdownInline
                markdown={annotationLine(
                  v().meta.intent,
                  v().meta.git?.branch ?? "",
                )}
              />
            </span>
          </Show>
          {/* Anchor stops propagation so a tap on the PR doesn't toggle
           *  the enclosing Drawer.Trigger. */}
          <Show when={activeArm(v().meta)}>
            {(active) => (
              <>
                <Show when={prValue(active().pr)}>
                  {(pr) => (
                    <a
                      data-testid="terminal-meta-pr-compact"
                      href={pr().url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs font-mono text-fg-3 hover:text-accent shrink-0"
                      title={prTooltip(pr())}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      #{pr().number}
                    </a>
                  )}
                </Show>
                <Show when={prUnavailableSource(active().pr)}>
                  {(source) => (
                    <PrUnavailableButton
                      source={source()}
                      testId="terminal-meta-pr-unavailable-compact"
                    />
                  )}
                </Show>
              </>
            )}
          </Show>
          <Show when={activeArm(v().meta)?.agent?.taskProgress}>
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

const NameSpan: Component<{
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
}> = (props) => (
  <span
    data-testid="terminal-meta-name"
    class="inline-flex items-center gap-1.5 truncate shrink-0 max-w-[22ch]"
    style={{ "--repo-color": props.info.repoColor }}
    title={props.meta.cwd}
  >
    <RepoMonogram
      group={props.info.key.group}
      color={props.info.repoColor}
      size="xs"
      data-testid="terminal-meta-monogram"
    />
    <span class="repo-name-ink truncate">{props.info.key.group}</span>
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

/** Dynamic-workflow fan-out indicator: the background workflow's name and
 *  the count of sub-agents it has spawned so far. Shown while the agent is
 *  busy-waiting on the workflow (state `running_background`). */
const AgentWorkflowBadge: Component<{ name: string; agents: number }> = (
  props,
) => (
  <div
    data-testid="agent-workflow-badge"
    class="ml-auto flex items-center gap-1 shrink-0 text-[0.65rem] text-fg-2"
    title={`Background workflow "${props.name}" · ${props.agents} sub-agents`}
  >
    <span class="truncate max-w-24">{props.name}</span>
    <span class="tabular-nums text-fg-3">{props.agents}▸</span>
  </div>
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
