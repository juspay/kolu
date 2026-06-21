/** DormantTileBody — the frozen body of a SLEEPING terminal.
 *
 *  No xterm, no PTY, no stream attach: a sleeping tile holds no live resource, so
 *  this imports NO `Terminal`/xterm and never touches the attach path. It renders
 *  a moonlit, dimmed placeholder showing the agent it will resume and a Wake
 *  call-to-action that re-spawns + resumes (session-restore-of-one). The moonlit
 *  palette is fixed (not the per-terminal theme), so a sleeping tile reads
 *  consistently "asleep" regardless of which theme it carries.
 *
 *  Clicking the body FOCUSES the tile (focus-frozen) — it does not wake; only the
 *  explicit Wake button respawns. This is the canvas/mobile sleeping body; the
 *  swap between this and the live `Terminal` tree lives in `TerminalContent`. */

import { sleepingArm } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { formatTimeAgo } from "./staleness";
import { useTerminalStore } from "./useTerminalStore";

const DormantTileBody: Component<{
  terminalId: TerminalId;
  onWake: () => void;
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const meta = () => store.getMetadata(props.terminalId);
  const sleptAgo = () => {
    const arm = sleepingArm(meta());
    return arm ? formatTimeAgo(arm.sleptAt) : "";
  };
  const lastAgent = () => meta()?.lastAgentCommand ?? null;

  return (
    <div
      class="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-3 bg-[#171a20] px-4 text-center text-[#8895ad]"
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
      <Show when={lastAgent()}>
        {(cmd) => (
          <div class="max-w-full truncate font-mono text-xs text-[#5b626d]">
            {cmd()}
          </div>
        )}
      </Show>
      <div class="text-[0.65rem] uppercase tracking-wide text-[#5b626d]">
        PTY released
      </div>
      <button
        type="button"
        class="mt-1 rounded-md bg-[#8895ad] px-3 py-1 text-xs font-semibold text-[#0e1014] transition-colors hover:bg-[#a3afc4]"
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
