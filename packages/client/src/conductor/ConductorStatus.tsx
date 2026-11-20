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
 *    2. N PIECES OF WORK · M WAITING ON YOU — what kolu has in flight, and
 *       how much of it is now your turn. ABSENT AT ZERO, each part on its
 *       own: `0 pieces of work` is a readout of nothing, and a press that
 *       opened an empty column was a promise of a list that was not there.
 *       Below the two-column breakpoint it is a button and the column opens
 *       above it; on a window wide enough for the side column the column is
 *       already on screen beside this line, so the same words are a readout
 *       and nothing presses.
 *    3. N WAITING — events held because a turn is running, which go out
 *       together the moment it ends. Absent at zero, for the same reason.
 *    4. ↯ STEERS, while the offer stands. It had a row of its own under the
 *       composer; a chord that is only true during a running turn belongs on
 *       the line that reports the running turn, and the sentence it used to
 *       spell out is its tip.
 *
 *  Stop stays beside Send, where it has always been. This line reports; it is
 *  not a second place to act on the turn. */

import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { isOpen } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import WorkColumn from "./WorkColumn";
import { useNeedsYou, useWorks } from "./useWorks";
import { isListingOut, toggleListing } from "./workListing";
import { useMemoryNeed } from "./memory/useMemory";
import { waitingCount, worksStatusWords } from "./workReadings";
import { conductorWide } from "./conductorLayout";
import { useShownClock } from "../ui/shown";
import { STEER_KEYBIND, steerOnOffer } from "./steer";
import { statusDetail, statusSince } from "./statusReadout";

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
  // The 1 s tick, STOPPED while the pane is hidden (`ui/shown.ts`): the
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
  // The band's open/closed is the LISTING'S (`./workListing.ts`), not this
  // line's: a work chip anywhere in the chat brings its card into view, and
  // on a narrow window that means bringing the band out first.
  const open = isListingOut;
  /** WHAT KOLU HAS IN FLIGHT, off the `works` collection — the pieces of work, and
   *  how many things are waiting on you.
   *
   *  The second number is the tab's badge, said here in words, by the same
   *  rule (`waitingCount`): a work waiting on an answer counts once however
   *  many questions it holds, plus every question about NO work, which is the
   *  conversation's own. A part that would read `0` is simply not there. */
  const works = useWorks();
  const needs = useNeedsYou();
  const memory = useMemoryNeed();
  const pieces = createMemo(
    () => works().filter(([, one]) => isOpen(one)).length,
  );
  const waiting = createMemo(() =>
    waitingCount(needs(), props.state.openAsks, memory()),
  );
  const words = createMemo(() => worksStatusWords(pieces(), waiting()));
  const held = () => props.state.held.length;
  /** The column is OPENED from here only below the breakpoint. On a wide
   *  window `ConductorPane` is already drawing the same column beside the
   *  conversation, and a second copy over it would be two lists of one fact —
   *  with the same cards open in both. It opens whenever there is any work
   *  to show, a finished one included: a chip on a turn scrolled back to is
   *  often about a work nothing is running for any more, and the count's own
   *  button (which reads only what is in flight) is not there to open it. */
  const opensHere = () => open() && !conductorWide() && works().length > 0;
  /** Steering is ON OFFER — the chord's hint, where the turn is reported. */
  const steers = createMemo(() => steerOnOffer(props.state));

  return (
    <>
      <Show when={opensHere()}>
        <WorkColumn placement="inline" />
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
        // `px-5` is the reading column's gutter — the transcript above and
        // the composer below are struck from the same two edges, so the three
        // read as one column rather than three bands.
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-edge px-5 py-1.5 font-mono text-[0.65rem] leading-4"
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
        {/* THE STEER HINT, where the running turn is reported — not a row of
            its own under the composer. A chord nobody mentions is a chord
            nobody uses, and this one is only on SOMETIMES, so the hint stands
            exactly while it would work, which also teaches when it would not.
            `formatKeybind` prints it in the reader's own idiom (`Alt+Enter`
            off macOS, `⌥Enter` on it), and the sentence it used to spell out
            is the tip. */}
        <Show when={steers()}>
          <Tip
            class="flex items-center"
            label="Your words go into the turn that is running, instead of queueing behind it"
          >
            <span
              data-testid="conductor-steer-hint"
              class="shrink-0 text-accent"
            >
              ↯ {formatKeybind(STEER_KEYBIND)} steers
            </span>
          </Tip>
        </Show>
        {/* NOTHING AT ZERO — no number, and no control that would open an
            empty column. Each half rides as DATA as well as words, and each
            is ABSENT rather than `0`: a reader wants the sentence, and
            anything reading this line wants the fact without parsing English
            that may be singular today and plural next frame. */}
        {/* ... except that a band a chip brought out must still be put
            away, so while it is out the control stays, as "Hide work". */}
        <Show when={words() !== "" || opensHere()}>
          <Tip
            class="flex items-center"
            label="The pieces of work kolu has in flight, and how many things are now waiting on an answer from you"
          >
            <Show
              when={!conductorWide()}
              fallback={
                // A READOUT on a wide window: the column it would open is
                // already beside this line, in the pane's side column.
                <span
                  data-testid="conductor-work-count"
                  data-work={pieces() > 0 ? pieces() : undefined}
                  data-waiting={waiting() > 0 ? waiting() : undefined}
                  class="shrink-0 text-fg-2"
                >
                  {words()}
                </span>
              }
            >
              <button
                type="button"
                data-testid="conductor-work-count"
                data-work={pieces() > 0 ? pieces() : undefined}
                data-waiting={waiting() > 0 ? waiting() : undefined}
                aria-expanded={open()}
                class="shrink-0 rounded-md border border-edge-bright px-1.5 py-px text-fg-2 hover:text-fg hover:bg-surface-2 cursor-pointer"
                onClick={toggleListing}
              >
                {words() === "" ? "Hide work" : words()}
              </button>
            </Show>
          </Tip>
        </Show>
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
