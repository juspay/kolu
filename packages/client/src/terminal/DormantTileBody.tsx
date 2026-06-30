/** DormantTileBody — the frozen body of a SLEEPING terminal.
 *
 *  No xterm, no PTY, no stream attach: a sleeping tile holds no live resource, so
 *  this imports NO `Terminal`/xterm and never touches the attach path. It renders
 *  a moonlit, dimmed placeholder showing the agent it will resume, the last-known
 *  metadata (cwd · branch · GitHub PR) frozen at sleep, and a Wake call-to-action
 *  that re-spawns + resumes (session-restore-of-one). The moonlit palette is fixed
 *  (not the per-terminal theme), so a sleeping tile reads consistently "asleep"
 *  regardless of which theme it carries.
 *
 *  Clicking the body FOCUSES the tile (focus-frozen) — it does not wake; only the
 *  explicit Wake button respawns. This is the canvas/mobile sleeping body; the
 *  swap between this and the live `Terminal` tree lives in `TerminalContent`. */

import { prValue } from "anyforge/schemas";
import { resumableCommand, sleepingArm } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { GitBranchIcon, PrStateIcon } from "../ui/Icons";
import ChecksIndicator from "./ChecksIndicator";
import { MOONLIT } from "./moonlit";
import { prTooltip } from "./prTooltip";
import { formatTimeAgo } from "./staleness";
import { useTerminalStore } from "./useTerminalStore";

const DormantTileBody: Component<{
  terminalId: TerminalId;
  onWake: () => void;
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const meta = () => store.getMetadata(props.terminalId);
  const arm = () => sleepingArm(meta());
  const sleptAgo = () => {
    const a = arm();
    return a ? formatTimeAgo(a.sleptAt) : "";
  };
  // The agent line wake will RESUME — read off the fold-derived `restoreTarget`
  // (it rides the authored sleeping arm), so it shows the command ONLY when wake
  // will actually relaunch an agent: `exact` (the exact conversation) or
  // `legacyMostRecent`. Null for `none`/absent — a quit-to-shell or never-launched
  // terminal whose wake brings back a bare shell, so the line stays honest.
  const resumableAgent = () => resumableCommand(arm()?.restoreTarget);
  // Last-known metadata, frozen at sleep. `cwd`, `git.branch`, and `pr` ALL ride the
  // persisted restore-relevant base (the `PersistedSnapshot`) — there is no
  // frozen-`pr`-off-the-live-overlay special case; wake re-spawns and re-resolves the
  // live overlay. `prValue` projects the resolved PR (or null for a pending/absent/
  // unavailable snapshot — a dormant tile can't act on those, so only a resolved PR
  // is shown).
  const cwd = () => arm()?.cwd ?? null;
  const branch = () => arm()?.git?.branch ?? null;
  const snapshotPr = () => {
    const pr = arm()?.pr;
    return pr ? prValue(pr) : null;
  };

  return (
    <div
      class="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-3 bg-[var(--moonlit-bg)] px-4 text-center text-[var(--moonlit-accent)]"
      // Moonlit palette flows from the single MOONLIT source as CSS custom
      // properties so the arbitrary-value classes (which can't read a JS const)
      // and the hover state stay in sync with the minimap + RowPips ☾.
      style={{
        "--moonlit-bg": MOONLIT.bg,
        "--moonlit-accent": MOONLIT.accent,
        "--moonlit-dim": MOONLIT.dim,
        "--moonlit-ink": MOONLIT.ink,
        "--moonlit-accent-hover": MOONLIT.accentHover,
      }}
      // Focus-frozen: clicking the dormant body makes the tile active/selected
      // like any terminal, but never wakes it — only Wake respawns.
      onPointerDown={() => props.onFocus?.()}
      data-sleeping="true"
      data-testid="dormant-tile-body"
    >
      <div class="text-4xl leading-none opacity-80" aria-hidden="true">
        ☾
      </div>
      <div class="text-sm font-semibold">
        Asleep{sleptAgo() ? ` · ${sleptAgo()}` : ""}
      </div>
      <Show when={resumableAgent()}>
        {(cmd) => (
          <div class="max-w-full truncate font-mono text-xs text-[var(--moonlit-dim)]">
            {cmd()}
          </div>
        )}
      </Show>
      {/* Last-known metadata, frozen at sleep — the working directory, git branch,
          and the GitHub PR the terminal was on. Reuses the live tile's PR chip
          (PrStateIcon · ChecksIndicator · #N · title) verbatim. */}
      <div class="flex w-full flex-col items-center gap-1 text-xs text-[var(--moonlit-dim)]">
        <Show when={cwd()}>
          {(c) => (
            <div
              class="max-w-full truncate font-mono"
              title={c()}
              data-testid="dormant-cwd"
            >
              {c()}
            </div>
          )}
        </Show>
        <Show when={branch()}>
          {(b) => (
            <div
              class="flex max-w-full items-center gap-1"
              data-testid="dormant-branch"
            >
              <GitBranchIcon class="h-3 w-3 shrink-0" />
              <span class="truncate">{b()}</span>
            </div>
          )}
        </Show>
        <Show when={snapshotPr()}>
          {(info) => (
            <span
              class="flex max-w-full items-center gap-1"
              data-testid="dormant-pr"
              title={prTooltip(info())}
            >
              <PrStateIcon state={info().state} class="h-3 w-3 shrink-0" />
              <Show when={info().checks}>
                {(checks) => <ChecksIndicator status={checks()} />}
              </Show>
              <a
                href={info().url}
                target="_blank"
                rel="noopener noreferrer"
                class="shrink-0 hover:text-[var(--moonlit-accent)]"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                #{info().number}
              </a>
              <span class="truncate">{info().title}</span>
            </span>
          )}
        </Show>
      </div>
      <div class="text-[0.65rem] uppercase tracking-wide text-[var(--moonlit-dim)]">
        PTY released
      </div>
      <button
        type="button"
        class="mt-1 rounded-md bg-[var(--moonlit-accent)] px-3 py-1 text-xs font-semibold text-[var(--moonlit-ink)] transition-colors hover:bg-[var(--moonlit-accent-hover)]"
        onClick={(e) => {
          // Don't let the click bubble to the focus-frozen pointer handler.
          e.stopPropagation();
          props.onWake();
        }}
        data-testid="wake-button"
      >
        Wake
      </button>
    </div>
  );
};

export default DormantTileBody;
