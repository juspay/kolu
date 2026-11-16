/** WHERE A WORK STANDS, in one line — who it waits on, why, and for how long.
 *
 *  The card's shut face and a work chip's hover card draw this one line, so
 *  the two say the same thing in the same words: the lead in the waiter's
 *  colour, the detail after it (a PR it names is a link), and how long the
 *  wait has run (or, once the work is over, how long ago it ended). */

import { DASH } from "kolu-common/surface";
import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, Show } from "solid-js";
import { elapsedSince } from "../time/duration";
import PrText from "./PrText";
import { type StandingLine, WAITER_INK } from "./workReadings";

const WorkStanding: Component<{
  work: Work;
  line: StandingLine;
  /** The clock the wait is measured to. */
  now: number;
  /** The face it is drawn on — the card's own line, or the copy in a chip's
   *  hover card — so the two are never one test id on one screen. */
  testId: "work-standing" | "work-chip-standing";
}> = (props) => {
  /** How long the current wait has run — or, once the work has ended, how
   *  long ago it ended ("just now" inside the first second, where the
   *  elapsed readout has no figure to give). */
  const endedOrElapsed = (): string => {
    const elapsed = elapsedSince(props.line.since, props.now);
    if (props.line.who !== "done") return elapsed;
    return elapsed === DASH ? "just now" : `${elapsed} ago`;
  };
  /** The lead's ink: the waiter's own colour, and the quiet one for a work
   *  that is over — "done" is not a waiter, so it has no colour there. */
  const ink = (): string => {
    const who = props.line.who;
    return who === "done" ? "text-fg-2" : WAITER_INK[who].text;
  };
  return (
    <span
      data-testid={props.testId}
      data-who={props.line.who}
      class="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.7rem]"
    >
      <b class={ink()}>{props.line.lead}</b>
      <Show when={Option.getOrUndefined(props.line.what)}>
        {(what) => (
          <span class="min-w-0 truncate text-fg-2">
            · <PrText work={props.work} text={what()} />
          </span>
        )}
      </Show>
      <span class="font-mono text-[0.62rem] tabular-nums text-fg-3">
        · {endedOrElapsed()}
      </span>
    </span>
  );
};

export default WorkStanding;
