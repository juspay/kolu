/** A TERMINAL'S STATE, AND FOR HOW LONG — the words a terminal's row and a
 *  live pane's head both say about it: its state, then " for " and a time.
 *
 *  The word is the browser's reading of the terminal (`terminalStatus`); the
 *  time is how long kolu's own watch has had it at its level
 *  (`useSeen`'s reading). The two are read by different readers and can
 *  disagree for a while — a terminal still being found here while the watch
 *  has had it working for an hour. So the time is said only beside the word
 *  it measures: when the watch's level is the level these words describe
 *  (`watchLevelOf`). Otherwise the word stands alone. */

import type { MemberReading } from "kolu-common/works";
import { type Component, Show } from "solid-js";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import { watchLevelOf } from "./terminalStatus";

const StateFor: Component<{
  /** The state, worded as its place words it. */
  word: string;
  standing: FleetTerminalStanding;
  /** Kolu's watch of the terminal, if it has one. */
  reading: MemberReading | undefined;
  now: number;
  /** The time's test id, per place. */
  testId: string;
}> = (props) => {
  /** The watch's start of this state, when the watch reads the same state. */
  const since = () => {
    const read = props.reading;
    return read !== undefined && read.level === watchLevelOf(props.standing)
      ? read.since
      : undefined;
  };
  return (
    <>
      <span class="font-semibold text-fg">{props.word}</span>
      <Show when={since()}>
        {(at) => (
          <span
            data-testid={props.testId}
            title={`${props.word} for ${elapsedSince(at(), props.now)}`}
            class="tabular-nums text-fg-3"
          >
            {" for "}
            {elapsedSince(at(), props.now)}
          </span>
        )}
      </Show>
    </>
  );
};

export default StateFor;
