/** THE LOCK, as a person sees it — the banner in a driven terminal's title
 *  area, and the ONE control that changes who is driving.
 *
 *  Drawn only for a terminal a work actually drives (an active member of a
 *  work in progress whose mode runs a waterfall). A watch — the human asked
 *  kolu to keep an eye on THEIR terminal — and a work whose mode nobody has
 *  answered yet drive nothing, so there is nothing here to say.
 *
 *  ONE control, whichever way round it is: while the Conductor drives, **Take
 *  over**; while the person has it, **Hand back**. Both are
 *  `conductor.takeOver` / `conductor.handBack` on the kolu surface, which
 *  declare `ConductorRefused` ALONE — a conversation that is down must never
 *  stand between a person and the keyboard of a terminal in front of them —
 *  and the refusal's own sentence is the toast.
 *
 *  The same component in both places it is needed (the canvas tile's title
 *  bar, above the phone's key bar), because the banner and the gate must be
 *  one reading of one index: a phone that said "Taken over" while the
 *  keystroke gate still blocked would be two answers to one question. */

import { type Component, createMemo, Show } from "solid-js";
import { useConductor } from "./useConductor";
import { useMembership } from "./useWorks";
import { nudgedTerminal } from "./personInput";
import { LOCK_NUDGE_WORDS, lockWords } from "./workReadings";

const CONTROL_CLASS =
  "shrink-0 rounded-sm px-1.5 py-[0.1rem] font-mono text-[0.58rem] font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const WorkLock: Component<{
  /** The fleet ref (`<encodedHostKey>/<terminalId>`) of the terminal this
   *  banner is about. */
  terminal: string;
  /** WHERE THIS COPY IS DRAWN, and nothing more. `title` is a pill among the
   *  canvas tile's title-bar chrome; `bar` is the phone's own full-width band
   *  directly above the key bar — which owns its band rather than being
   *  wrapped in one, so a terminal no work drives leaves no empty strip
   *  between the screen and the keys. */
  placement: "title" | "bar";
}> = (props) => {
  const membership = useMembership();
  const conductor = useConductor();
  /** The membership ONLY while something drives this terminal — the `null`
   *  driver (no lock) and the absent membership (no work) are one case here,
   *  and it draws nothing. */
  const driven = createMemo(() => {
    const at = membership().get(props.terminal);
    return at === undefined || at.driver === null ? undefined : at;
  });
  const nudged = () => nudgedTerminal(props.terminal);
  /** WHAT THE TITLE BAR SHOWS: the driver alone. The mark immediately before
   *  it already says `◆ IMPLEMENTOR · <work>`, so repeating the part and the
   *  work there cost the tile's own name the room it needs — the two read as
   *  one line, "◆ Implementor · <work> · Driven by the Conductor". The phone
   *  band has no mark beside it, so it says the whole sentence, and the
   *  sentence is the tooltip in both. */

  return (
    <Show when={driven()}>
      {(at) => (
        <span
          data-testid="work-lock"
          data-driver={at().driver ?? undefined}
          data-work={at().work}
          // The whole sentence is always reachable, whichever half is drawn.
          title={lockWords(at())}
          // ONE `class` binding derived from placement and driver: a
          // `classList` beside a static `class` loses (Solid applies the
          // static one last), which is `HostChipShell`'s worked example.
          class={`flex min-w-0 items-center gap-1.5 font-mono text-[0.58rem] leading-[1.4] ${
            props.placement === "bar"
              ? "w-full border-t border-edge px-2 py-1"
              : "me-1 inline-flex shrink rounded-sm px-1 py-[0.1rem]"
          } ${
            at().driver === "you"
              ? "bg-alert/15 text-alert"
              : "bg-conductor/15 text-conductor"
          }`}
        >
          <span class="min-w-0 truncate font-semibold">
            {props.placement === "bar"
              ? lockWords(at())
              : at().driver === "you"
                ? "Taken over"
                : "Driven by the Conductor"}
          </span>
          {/* The control, and the nudge ANCHORED TO IT — the hint is an
              absolutely positioned popover rather than a word in the row, so
              a blocked keystroke rings the one control that unblocks it and
              moves nothing else on the title bar. */}
          <span class="relative shrink-0">
            <Show
              when={at().driver === "conductor"}
              fallback={
                <button
                  type="button"
                  data-testid="work-hand-back"
                  class={`${CONTROL_CLASS} bg-alert/20 text-alert hover:bg-alert/30`}
                  // Tile chrome lives on a draggable title bar: a press here
                  // is this control's, never the start of a tile drag.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    conductor.handBack(props.terminal);
                  }}
                >
                  Hand back
                </button>
              }
            >
              <button
                type="button"
                data-testid="work-take-over"
                class={`${CONTROL_CLASS} bg-conductor/20 text-conductor hover:bg-conductor/30 ${
                  nudged() ? "ring-2 ring-alert animate-pulse" : ""
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  conductor.takeOver(props.terminal);
                }}
              >
                Take over
              </button>
            </Show>
            <Show when={nudged()}>
              <span
                data-testid="work-lock-nudge"
                role="status"
                class={`absolute z-30 mt-1 whitespace-nowrap rounded-md border border-alert/40 bg-surface-1 px-2 py-1 text-[0.6rem] font-normal normal-case text-alert shadow-lg ${
                  props.placement === "bar"
                    ? "bottom-full left-0 mb-1"
                    : "top-full right-0"
                }`}
              >
                {LOCK_NUDGE_WORDS}
              </span>
            </Show>
          </span>
        </span>
      )}
    </Show>
  );
};

export default WorkLock;
