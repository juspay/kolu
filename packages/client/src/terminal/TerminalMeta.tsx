/** Terminal metadata display — name, branch, PR, agent task progress.
 *  Shared between the canvas tile title bar (full mode) and the mobile
 *  pull-handle (compact mode). */

import { type Component, Show } from "solid-js";
import ChecksIndicator from "./ChecksIndicator";
import Tip from "../ui/Tip";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import { shortenCwd } from "../path";

/** "normal" = interactive (compact text, PR links).
 *  "readonly" = display-only (larger text, no links).
 *  "compact" = name row only (mobile pull-handle); drops cwd, branch row,
 *   PR row, foreground row. */
export type TerminalMetaMode = "normal" | "readonly" | "compact";

const TerminalMeta: Component<{
  info: TerminalDisplayInfo | undefined;
  mode?: TerminalMetaMode;
}> = (props) => {
  const mode = () => props.mode ?? "normal";
  /** Compact mode (mobile pull-handle) renders the name row only —
   *  branch/PR/foreground/cwd live in the chrome sheet, not on
   *  the always-visible strip. */
  const full = () => mode() !== "compact";
  const nameClass = () =>
    mode() === "normal" || mode() === "compact"
      ? "text-sm font-medium"
      : "text-base font-semibold";
  const detailClass = () => (mode() === "normal" ? "text-xs" : "text-sm");
  const i = () => props.info;

  return (
    <Show when={i()} fallback={<TerminalMetaSkeleton />}>
      {(info) => (
        <>
          {/* Name row — `name suffix [worktree-icon] cwd [progress]`.
           *  Sub-count lives on the title-bar split toggle (one source
           *  of truth for "this tile has children"); the agent task
           *  progress bar owns the right slot when an agent is running.
           *  The agent state itself (Thinking/Tool use/Waiting) is
           *  shown by the title bar's agent indicator button — no
           *  separate agent row here. */}
          <div class={`flex items-center gap-1.5 ${nameClass()} min-w-0`}>
            <span
              data-testid="terminal-meta-name"
              class="truncate min-w-0"
              style={{ color: info().repoColor }}
            >
              {info().name}
            </span>
            {/* Suffix gates on the same `meta.displaySuffix` source as
             *  the pill tree, but only renders in non-compact contexts.
             *  The pill tree needs disambiguation because it lists peers
             *  side-by-side; the mobile pull-handle shows a single
             *  focused terminal, so the suffix is just noise there. */}
            <Show when={full() && info().meta.displaySuffix}>
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
            <Show when={info().meta.git}>
              {(git) => (
                <>
                  <Show when={git().isWorktree}>
                    <span
                      data-testid="worktree-indicator"
                      class="text-fg-3 shrink-0"
                      title="Worktree"
                    >
                      <WorktreeIcon />
                    </span>
                  </Show>
                  {/* Compact mode mirrors the pill tree: repo + branch.
                   *  The dedicated branch+PR row below is suppressed in
                   *  compact. */}
                  <Show when={!full()}>
                    <Tip label={git().branch}>
                      <span
                        data-testid="terminal-meta-branch"
                        class="text-xs truncate min-w-0"
                        style={{ color: info().branchColor }}
                        classList={{ "text-fg-2": !info().branchColor }}
                      >
                        {git().branch}
                      </span>
                    </Tip>
                  </Show>
                </>
              )}
            </Show>
            {/* PR number — compact mode only (full mode renders the PR
             *  inline with branch below). Anchor so taps open the PR;
             *  stopPropagation keeps the enclosing pull-handle
             *  (Drawer.Trigger) from toggling. */}
            <Show when={!full() && info().meta.pr}>
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
            <Show when={full() && info().meta.cwd}>
              {(cwd) => (
                <span
                  data-testid="terminal-meta-cwd"
                  class="text-xs font-mono text-fg-3 truncate min-w-0"
                  title={cwd()}
                >
                  {shortenCwd(cwd())}
                </span>
              )}
            </Show>
            {/* Agent task progress — slim bar + N/M to the right of the
             *  name row. Only when the agent reports task progress;
             *  otherwise the right slot is empty. */}
            <Show when={info().meta.agent?.taskProgress}>
              {(tp) => (
                <div
                  data-testid="agent-task-progress"
                  class="ml-auto flex items-center gap-1.5 shrink-0 w-24"
                  title={`${tp().completed}/${tp().total} tasks completed`}
                >
                  <div class="flex-1 h-1 rounded-full bg-fg/10 overflow-hidden">
                    <div
                      class="h-full rounded-full bg-busy transition-all duration-300"
                      style={{
                        width: `${tp().total > 0 ? (tp().completed / tp().total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span class="text-[0.65rem] text-fg-2 tabular-nums">
                    {tp().completed}/{tp().total}
                  </span>
                </div>
              )}
            </Show>
          </div>

          {/* Branch + PR — combined row. Tooltip on branch shows full
           *  name when truncated. PR (if present) follows inline:
           *  state icon, checks indicator, #N (linked in normal mode),
           *  truncated title. */}
          <Show
            when={full() && info().meta.git}
            fallback={
              <Show when={full()}>
                <div
                  data-testid="terminal-meta-branch"
                  class={`${detailClass()} text-fg-2`}
                >
                  {"\u00A0"}
                </div>
              </Show>
            }
          >
            {(git) => (
              <div class={`flex items-center gap-1.5 min-w-0 ${detailClass()}`}>
                <Tip label={git().branch}>
                  <span
                    data-testid="terminal-meta-branch"
                    class="truncate shrink-0 max-w-[16ch]"
                    style={{ color: info().branchColor }}
                    classList={{ "text-fg-2": !info().branchColor }}
                  >
                    {git().branch}
                  </span>
                </Tip>
                <Show when={info().meta.pr}>
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
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>

          {/* Foreground process/title row — OSC 2 process title when
           *  present and not just a duplicate of the cwd we already
           *  show on the name row. */}
          <Show when={full() && info().meta.foreground}>
            {(fg) => {
              const text = () => fg().title ?? fg().name;
              const isCwd = () => {
                const cwd = info().meta.cwd;
                if (!cwd) return false;
                const t = text();
                return t === cwd || t === shortenCwd(cwd);
              };
              return (
                <Show when={!isCwd()}>
                  <div
                    class="flex items-center gap-2 min-w-0 mt-1"
                    classList={{
                      "mt-auto": mode() === "readonly",
                    }}
                  >
                    <span
                      class="text-xs text-fg-3 truncate min-w-0 flex-1"
                      data-testid="process-name"
                      title={text()}
                    >
                      {text()}
                    </span>
                  </div>
                </Show>
              );
            }}
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
