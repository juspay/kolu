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
  const resumableAgent = () => resumableCommand(arm()?.restoreTarget);
  const cwd = () => arm()?.cwd ?? null;
  const branch = () => {
    const git = arm()?.git;
    return git?.kind === "repo" ? git.info.branch : null;
  };
  const snapshotPr = () => {
    const pr = arm()?.pr;
    return pr ? prValue(pr) : null;
  };

  return (
    <div
      class="flex h-full min-h-0 flex-1 select-none flex-col items-center justify-center bg-[var(--moonlit-bg)] text-center text-[var(--moonlit-accent)]"
      classList={{
        "gap-3 px-4": !compact(),
        "gap-1.5 px-2": compact(),
      }}
      style={{
        "--moonlit-bg": MOONLIT.bg,
        "--moonlit-accent": MOONLIT.accent,
        "--moonlit-dim": MOONLIT.dim,
        "--moonlit-ink": MOONLIT.ink,
        "--moonlit-accent-hover": MOONLIT.accentHover,
      }}
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
