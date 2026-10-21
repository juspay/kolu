/** DormantTileBody — the frozen body of a SLEEPING terminal.
 *
 *  No xterm, no PTY, no stream attach: a sleeping terminal holds no live resource,
 *  so this imports NO `Terminal`/xterm and never touches the attach path. It
 *  renders a moonlit, dimmed placeholder showing the agent it will resume, the
 *  last-known metadata (cwd · branch · GitHub PR) frozen at sleep, and a Wake
 *  call-to-action that re-spawns + resumes (session-restore-of-one). The moonlit
 *  palette is fixed (not the per-terminal theme), so a sleeping tile reads
 *  consistently "asleep" regardless of which theme it carries.
 *
 *  TWO SIZES, one component: `"tile"` is the full body of a dormant tile (or the
 *  main pane of a dormant family), while `"sub"` is the compact body a dormant
 *  SPLIT pane shows — the moon, "Asleep" and Wake, without the metadata block, so
 *  a frozen split still reads as asleep in a pane that is a fraction of a tile.
 *  Sleeping a terminal freezes its whole family, so both sizes are routinely on
 *  screen together; both carry `data-testid="dormant-tile-body"` (dormant panes
 *  are addressed by that in e2e) and `data-size` tells them apart.
 *
 *  Clicking the body FOCUSES the tile (focus-frozen) — it does not wake; only the
 *  explicit Wake button respawns. The per-pane swap between this and the live
 *  `Terminal` tree lives in `TerminalContent`. */

import { sleepingArm } from "@kolu/padi-client/surface";
import { prValue } from "anyforge/schemas";
import type { TerminalId } from "kolu-common/surface";
import { resumableCommand } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { GitBranchIcon } from "../ui/Icons";
import { ChecksIndicator, PrStateIcon } from "@kolu/solid-dockrow";
import { MOONLIT } from "./moonlit";
import { prTooltip } from "@kolu/solid-dockrow/rowValues";
import { formatTimeAgo } from "./staleness";
import { useTerminalStore } from "./useTerminalStore";

const DormantTileBody: Component<{
  terminalId: TerminalId;
  /** `"tile"` (default) is the whole body of a dormant tile; `"sub"` is the
   *  compact body of a dormant split pane. */
  size?: "tile" | "sub";
  onWake: () => void;
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const compact = () => props.size === "sub";
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
  const branch = () => {
    // A branch only when the frozen record knew its repo.
    const git = arm()?.git;
    return git?.kind === "repo" ? git.info.branch : null;
  };
  const snapshotPr = () => {
    const pr = arm()?.pr;
    return pr ? prValue(pr) : null;
  };

  return (
    <div
      class="flex min-h-0 flex-1 select-none flex-col items-center justify-center bg-[var(--moonlit-bg)] text-center text-[var(--moonlit-accent)]"
      classList={{
        "gap-3 px-4": !compact(),
        "gap-1.5 px-2": compact(),
      }}
      // Moonlit palette flows from the single MOONLIT source as CSS custom
      // properties so the arbitrary-value classes (which can't read a JS const)
      // and the hover state stay in sync with the minimap + Dock row ☾.
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
      data-size={props.size ?? "tile"}
      data-testid="dormant-tile-body"
    >
      <div
        classList={{
          "text-4xl leading-none opacity-80": !compact(),
          "text-lg leading-none opacity-80": compact(),
        }}
        aria-hidden="true"
      >
        ☾
      </div>
      <div
        classList={{
          "text-sm font-semibold": !compact(),
          "text-xs": compact(),
        }}
      >
        Asleep{sleptAgo() ? ` · ${sleptAgo()}` : ""}
      </div>
      <Show when={!compact()}>
        <Show when={resumableAgent()}>
          {(cmd) => (
            <div class="max-w-full truncate font-mono text-xs text-[var(--moonlit-dim)]">
              {cmd()}
            </div>
          )}
        </Show>
        {/* Last-known metadata, frozen at sleep — the working directory, git
            branch, and the GitHub PR the terminal was on. Reuses the live tile's
            PR chip (PrStateIcon · ChecksIndicator · #N · title) verbatim. */}
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
      </Show>
      <button
        type="button"
        classList={{
          "mt-1 rounded-md bg-[var(--moonlit-accent)] px-3 py-1 text-xs font-semibold text-[var(--moonlit-ink)] transition-colors hover:bg-[var(--moonlit-accent-hover)]":
            !compact(),
          "rounded bg-[var(--moonlit-accent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--moonlit-ink)] transition-colors hover:bg-[var(--moonlit-accent-hover)]":
            compact(),
        }}
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
