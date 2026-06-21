/** Terminal metadata for the canvas tile title bar — two rows:
 *
 *    Row 1: name [suffix] [worktree] [foreground] [agent progress]
 *    Row 2: annotation [PR icon checks #N title]
 *
 *  Row 2 is the *annotation slot* (supplant rule): notes line-1 if
 *  the user set one, else the git branch name, else empty. Clicking
 *  the slot always opens the Notes tab — there's no separate
 *  glyph chip, so the slot is the canvas tile's sole notes
 *  affordance.
 *
 *  The mobile pull-handle has its own one-row layout — see
 *  `TerminalMetaCompact`. */

import { prValue } from "anyforge/schemas";
import { activeArm, prUnavailableSource } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { StatePip } from "../canvas/dock/RowPips";
import { agentBucket } from "../canvas/dockModel";
import { NotesMarkdownInline } from "../notes/NotesMarkdown";
import { annotationLine } from "../notes/text";
import { agentWorkflow } from "../ui/agentDisplay";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import Tip from "../ui/Tip";
import ChecksIndicator from "./ChecksIndicator";
import { PrUnavailableButton } from "./PrUnavailablePopover";
import { prTooltip } from "./prTooltip";
import type { TerminalDisplayInfo } from "./terminalDisplay";

const TerminalMeta: Component<{
  info: TerminalDisplayInfo | undefined;
  /** True when this terminal has unseen agent activity. Drives the
   *  leading state pip's attention escalation exactly as the dock row
   *  does, so the title and the dock can't disagree on what's loud.
   *  Sourced from view-state at the call site (`store.isUnread(id)`). */
  unread: boolean;
  /** Open the Notes tab for this terminal. Wired in `App.tsx` to
   *  select the tile + `rightPanel.showNotes()` + reveal. */
  onOpenNotes: () => void;
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
            <Show when={activeArm(info().meta)?.foreground}>
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
            <Show when={agentWorkflow(activeArm(info().meta)?.agent)}>
              {(wf) => (
                <AgentWorkflowBadge name={wf().name} agents={wf().agents} />
              )}
            </Show>
            <Show when={activeArm(info().meta)?.agent?.taskProgress}>
              {(tp) => (
                <AgentTaskProgress
                  completed={tp().completed}
                  total={tp().total}
                />
              )}
            </Show>
          </div>

          {/* Annotation row (supplant rule) + PR.
           *
           *  The slot shows notes line-1 if the user set one, else the
           *  git branch name, else a non-breaking-space placeholder.
           *  Clicking always opens the Notes tab — there is no
           *  separate glyph chip, so this slot is the canvas tile's
           *  sole notes affordance regardless of git state. */}
          <div class="flex items-center gap-1.5 min-w-0 text-xs">
            {/* Agent-state pip leading the branch/notes annotation —
             *  the same shape-distinct StatePip the dock row leads its
             *  annotation line with (spinning ring = working, dot =
             *  awaiting), reused verbatim so a working/awaiting agent
             *  reads identically in the title and the dock, and sits
             *  beside the same branch/notes context it does there.
             *  Gated on a live agent: when none is attached the title
             *  shows no pip (exactly as its agent-kind indicator vanishes
             *  when the session ends), leaving the dock's idle/parked
             *  triage states — which fold in recency/staleness — dock-only. */}
            <Show when={activeArm(info().meta)?.agent}>
              {(agent) => (
                <StatePip bucket={agentBucket(agent())} unread={props.unread} />
              )}
            </Show>
            <Tip label={info().meta.notes ? "Edit notes" : "Set notes"}>
              <button
                type="button"
                data-testid="terminal-meta-branch"
                aria-label={
                  info().meta.notes
                    ? "Edit terminal notes"
                    : "Set terminal notes"
                }
                class="appearance-none bg-transparent border-0 p-0 text-left [font:inherit] truncate shrink-0 max-w-[16ch] cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                style={{ color: info().annotationColor }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenNotes();
                }}
                onDblClick={(e) => e.stopPropagation()}
              >
                <NotesMarkdownInline
                  markdown={annotationLine(
                    info().meta.notes,
                    info().meta.git?.branch ?? "—",
                  )}
                />
              </button>
            </Tip>
            <Show when={activeArm(info().meta)}>
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
      )}
    </Show>
  );
};

/** Mobile pull-handle one-row variant — repo + branch + #PR inline.
 *  Mirrors what the workspace switcher shows for a focused terminal; the full
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
          <Show when={info().meta.notes ?? info().meta.git?.branch}>
            <span
              data-testid="terminal-meta-branch"
              class="text-xs truncate min-w-0"
              style={{ color: info().annotationColor }}
            >
              <NotesMarkdownInline
                markdown={annotationLine(
                  info().meta.notes,
                  info().meta.git?.branch ?? "",
                )}
              />
            </span>
          </Show>
          {/* Anchor stops propagation so a tap on the PR doesn't toggle
           *  the enclosing Drawer.Trigger. */}
          <Show when={activeArm(info().meta)}>
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
          <Show when={activeArm(info().meta)?.agent?.taskProgress}>
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
    {props.info.key.group}
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
