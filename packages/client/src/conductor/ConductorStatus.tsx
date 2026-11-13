/** THE ONE STATUS LINE — directly above the composer, because that is where a
 *  person looks.
 *
 *  It used to be a chip in the header, four feet of screen away from the box
 *  you type in, and it said one word. The conversation now has three facts a
 *  person needs at the moment they are about to speak to it, and all three
 *  live here, in one line, in this order:
 *
 *    1. WHAT IT IS DOING — the phase word (the chip's own vocabulary), what
 *       the turn in flight is doing (its newest call still out, else what it
 *       has said in that turn) and for how long, ticking, from `busySince`.
 *       The dot MOVES while it works:
 *       a readout that cannot be told from a frozen one is the defect this
 *       whole change is about.
 *    2. WATCHING N — the terminals kolu will wake it about. A button, because
 *       the list is the answer to "so what happens next"; it opens above.
 *    3. N WAITING — events held because a turn is running, which go out
 *       together the moment it ends. Absent at zero: a counter that renders
 *       its own silence is one every reader has to parse before ignoring.
 *
 *  Stop stays beside Send, where it has always been. This line reports; it is
 *  not a second place to act on the turn. */

import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import Tip from "../ui/Tip";
import ConductorWatchedPanel from "./ConductorWatchedPanel";
import { useShownClock } from "./conductorShown";
import { statusDetail, statusSince } from "./conductorStatus";

/** The line's ink, by what the conversation is doing — the header chip's own
 *  table, moved with it. `asking` outranks `working` on the wire already (a
 *  turn stopped on a form is blocked on a human), so this is a straight lookup
 *  and not a second precedence. */
const PHASE_CLASS: Record<ConductorState["phase"], string> = {
  offline: "text-fg-3",
  starting: "text-fg-2",
  idle: "text-fg-3",
  working: "text-busy",
  asking: "text-alert",
};

/** The dot beside the word. `working` PULSES — the one piece of motion on this
 *  line, and the whole of how a person tells a live turn from a stuck one at a
 *  glance (honouring `prefers-reduced-motion`, which turns it into a plain
 *  rust dot rather than removing the mark). */
const DOT_CLASS: Record<ConductorState["phase"], string> = {
  offline: "bg-fg-3/50",
  starting: "bg-fg-2 animate-pulse motion-reduce:animate-none",
  idle: "bg-fg-3/50",
  working: "bg-busy animate-pulse motion-reduce:animate-none",
  asking: "bg-alert",
};

const ConductorStatus: Component<{
  state: ConductorState;
  /** The transcript as it is drawn — where "what it is doing" is read from. */
  rows: readonly ConductorRow[];
}> = (props) => {
  // The 1 s tick, STOPPED while the pane is hidden (`conductorShown.ts`): the
  // pane is retained behind a host tab, and a second hand nobody can see is a
  // re-render a second for a readout that is not on screen.
  const now = useShownClock();
  // TWO DERIVATIONS, so the 1 s tick moves the one thing it can move. What
  // the conversation is doing is read off the transcript and the phase; how
  // long it has been at it is the only part that reads the clock. Folded
  // together, every tick re-walked the rows and re-made the words beside the
  // number.
  const detail = createMemo(() => statusDetail(props.state.phase, props.rows));
  const since = createMemo(() =>
    statusSince(props.state.phase, props.state.busySince, now()),
  );
  // The panel's open/closed, LOCAL — and it stays open across a trip to a
  // host tab, because the pane that holds this signal is retained rather than
  // rebuilt (`App.tsx`). Hoisting it to a module would say the opposite: that
  // it has to outlive its own view.
  const [open, setOpen] = createSignal(false);
  const watched = () => props.state.watched.length;
  const held = () => props.state.held.length;

  return (
    <>
      <Show when={open()}>
        <ConductorWatchedPanel watched={props.state.watched} />
      </Show>
      <div
        data-testid="conductor-status"
        data-phase={props.state.phase}
        // WRAPS rather than overflows: at 390px the state, its detail, the
        // clock and the two buttons do not fit on one line, and a line that
        // pushed the right-hand edge of the pane off screen would take the
        // composer's Send with it.
        //
        // `leading-4`, like the header and the strip: one LENGTH line-height
        // for the row, so the dot, the words and the two pills centre on one
        // line rather than each striking its own from its own font size.
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-edge px-3 py-1.5 font-mono text-[0.65rem] leading-4"
      >
        <span
          class={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[props.state.phase]}`}
          aria-hidden="true"
        />
        <span
          data-testid="conductor-phase"
          data-phase={props.state.phase}
          class={`shrink-0 font-semibold ${PHASE_CLASS[props.state.phase]}`}
        >
          {props.state.phase}
        </span>
        <Show when={detail()}>
          {(words) => (
            <span
              data-testid="conductor-status-detail"
              // `min-w-0` + `truncate`: the detail is the one part of the line
              // that is as long as an agent's sentence, so it is the part that
              // gives way first.
              class="min-w-0 flex-1 truncate text-fg-2"
            >
              {words()}
            </span>
          )}
        </Show>
        <Show when={since()}>
          {(elapsed) => (
            <Tip
              class="flex items-center"
              label="How long this turn has been running"
            >
              <span
                data-testid="conductor-status-since"
                class="shrink-0 text-fg-3 tabular-nums"
              >
                {elapsed()}
              </span>
            </Tip>
          )}
        </Show>
        <span class="flex-1" />
        <Tip
          class="flex items-center"
          label="The terminals kolu wakes this conversation about"
        >
          <button
            type="button"
            data-testid="conductor-watching"
            aria-expanded={open()}
            class="shrink-0 rounded-md border border-edge-bright px-1.5 py-px text-fg-2 hover:text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => setOpen(!open())}
          >
            watching {watched()}
          </button>
        </Tip>
        {/* WAITING is news — events kolu is holding because a turn is running.
            They go out together as one machine's line the moment it ends,
            however it ends, so this number is a promise and not a backlog. */}
        <Show when={held() > 0}>
          <Tip
            class="flex items-center"
            label="Watched terminals that rang while a turn was running — they arrive together when it ends"
          >
            <span
              data-testid="conductor-held"
              class="shrink-0 rounded-md bg-attention/20 px-1.5 py-px font-semibold text-attention tabular-nums"
            >
              {held()} waiting
            </span>
          </Tip>
        </Show>
      </div>
    </>
  );
};

export default ConductorStatus;
