import type { TerminalId } from "kolu-common/surface";
import { type Component, createEffect, createMemo, Show } from "solid-js";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { useShown } from "../ui/shown";
import { openPeek } from "./peek/usePeek";
import { liveArm, STATUS_DOT, terminalStatus } from "./terminalStatus";

/** A TERMINAL'S LINE IN THE TRANSCRIPT — how it stands, in words, and
 *  **Look**, which opens the peek on it. A work's own terminal rows are drawn
 *  by `WorkTerminals`, with their parts in fixed columns. */
const ConductorLook: Component<{
  /** The ENCODED host key the terminal lives on (`local`, `remote:…`). */
  host: string;
  id: TerminalId;
}> = (props) => {
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  const live = createMemo(() => liveArm(standing()));
  const lookable = () => live() !== undefined;
  const { showTipOnce } = useTips();
  const shown = useShown();
  // The first agent line with something to look at is the moment Look is
  // worth announcing; `showTipOnce` keeps it to once per browser. A pane kept
  // alive behind a host tab must not spend that one announcement on a toast
  // over somebody's terminal, so it waits until the conversation is the view
  // being read.
  createEffect(() => {
    if (shown() && lookable()) showTipOnce(CONTEXTUAL_TIPS.conductorLook);
  });

  const status = createMemo(() => terminalStatus(standing()));

  return (
    <div
      data-testid="conductor-look"
      data-standing={standing().kind}
      class="col-span-full min-w-0"
    >
      {/* ONE LINE, always: in a narrow column the status gives way first. */}
      <div class="flex min-w-0 items-center gap-2">
        <span
          class={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status().tone]}`}
        />
        <span
          data-testid="conductor-look-status"
          class="min-w-0 flex-1 truncate text-fg-2"
        >
          <span class="font-semibold text-fg">{status().state}</span>
          {/* BESIDE THE STATE, ahead of what it is doing: `working · 7/12 ·
              writing the plan`. The fraction is the one number on this line, so
              it is `tabular-nums` — a row whose count ticks over must not shift
              the words after it. */}
          <Show when={status().progress}>
            {(tasks) => (
              <>
                {" · "}
                <span
                  data-testid="conductor-look-progress"
                  class="tabular-nums"
                  title={tasks().title}
                >
                  {tasks().text}
                </span>
              </>
            )}
          </Show>
          <Show when={status().doing}>{(doing) => <> · {doing()}</>}</Show>
        </span>
        <Show when={lookable()}>
          <button
            type="button"
            data-testid="conductor-look-toggle"
            aria-haspopup="dialog"
            class="shrink-0 rounded-md border border-edge-bright bg-surface-2 px-2 py-px text-[0.7rem] font-semibold text-accent hover:bg-surface-3 cursor-pointer"
            onClick={() => openPeek({ host: props.host, id: props.id })}
          >
            Look
          </button>
        </Show>
      </div>
    </div>
  );
};

export default ConductorLook;
