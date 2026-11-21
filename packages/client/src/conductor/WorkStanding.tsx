/** WHERE A WORK STANDS, in one line — who it waits on, why, and for how long.
 *
 *  A work's face and a work chip's hover card draw this one line, so
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
  /** How long the current wait has run, in the line's own words: `asked 37m
   *  ago` for a question, `green for 12m` for a merge, `… ago` once the work
   *  has ended ("just now" inside the first second, where the elapsed readout
   *  has no figure to give), and the plain duration otherwise. */
  const clock = (): string => {
    const elapsed = elapsedSince(props.line.since, props.now);
    switch (props.line.clock) {
      case "asked":
        return elapsed === DASH ? "asked just now" : `asked ${elapsed} ago`;
      case "green":
        return `green for ${elapsed}`;
      case "ended":
        return elapsed === DASH ? "just now" : `${elapsed} ago`;
      case "for":
        return elapsed;
      default:
        return props.line.clock satisfies never;
    }
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
          // WHAT IS WANTED, in the waiter's ink when it is you: the one thing
          // on a needs-you card a person has to read.
          <span
            data-testid="work-standing-what"
            class={`min-w-0 truncate ${
              props.line.who === "you"
                ? `font-semibold ${WAITER_INK.you.text}`
                : "text-fg-2"
            }`}
          >
            · <PrText work={props.work} text={what()} />
          </span>
        )}
      </Show>
      <span class="font-mono text-[0.62rem] tabular-nums text-fg-3">
        · {clock()}
      </span>
    </span>
  );
};

export default WorkStanding;
