/** DormantTileBody — the body a sleeping tile renders instead of a live
 *  terminal. PURE placeholder: it reads ONLY persisted fields off the frozen
 *  sleeping record (intent · cwd · git branch) and NEVER imports
 *  `Terminal`/`TerminalContent` or attaches a PTY/xterm/WebGL context. A
 *  sleeping terminal has released its PTY, so routing it through the live body
 *  would hang an attach iterator against a terminal that no longer exists.
 *
 *  The one interactive affordance is the Wake CTA — wake is restore-one (spawn a
 *  fresh active terminal off this record + resume its agent). It reads the
 *  `useSessionRestore` singleton directly (F10) rather than taking an
 *  App-drilled `onWake` prop; `meta` stays a prop because it's the record this
 *  body renders, not a verb. The tile `id` is what `handleWake` needs. */

import type { SleepingTerminal, TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { useSessionRestore } from "../terminal/useSessionRestore";

const DormantTileBody: Component<{
  id: TerminalId;
  meta: SleepingTerminal;
}> = (props) => {
  const session = useSessionRestore();
  return (
    <div
      data-testid="dormant-tile-body"
      class="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-fg-3 select-none"
    >
      <div class="text-3xl leading-none text-fg-3/70" aria-hidden="true">
        ☾
      </div>
      <Show when={props.meta.intent}>
        {(intent) => (
          <div class="max-w-full truncate text-sm text-fg-2 text-center">
            {intent().split("\n")[0]}
          </div>
        )}
      </Show>
      <div class="max-w-full truncate font-mono text-xs text-fg-3/80">
        {props.meta.cwd}
      </div>
      <Show when={props.meta.git?.branch}>
        {(branch) => (
          <div class="max-w-full truncate font-mono text-[0.7rem] text-fg-3/60">
            {branch()}
          </div>
        )}
      </Show>
      <div class="text-[0.7rem] uppercase tracking-wide text-fg-3/50">
        PTY released
      </div>
      <button
        type="button"
        data-testid="dormant-wake"
        class="mt-1 px-4 py-1.5 rounded-lg bg-surface-2 text-fg-2 text-sm hover:bg-surface-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void session.handleWake(props.id);
        }}
      >
        Wake
      </button>
    </div>
  );
};

export default DormantTileBody;
