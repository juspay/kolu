/** THE THIN TIME BAR — a work's whole life, cut by who it was waiting on.
 *
 *  It is the one thing on a card that says where the time ACTUALLY went
 *  rather than where it is going: a strip that is mostly teal was the agents';
 *  a strip with a wide violet band in the middle waited on a person for an
 *  afternoon. The stretches are `kolu-work`'s own fold (`timeBar`), so the bar
 *  and the sentence above it step through the same events in the same order
 *  and cannot disagree about when a wait began.
 *
 *  Decorative to a screen reader: every stretch it draws is said in words by
 *  the standing line above it (in progress) or the "where the time went" line
 *  below it (finished), and a row of nineteen unlabelled slivers read aloud is
 *  noise. */

import { type Component, For } from "solid-js";
import { barSegments, WAITER_INK } from "./workReadings";
import type { Work } from "kolu-work";

const WorkBar: Component<{ work: Work; now: number }> = (props) => (
  <div
    data-testid="work-bar"
    aria-hidden="true"
    class="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-surface-2"
  >
    <For each={barSegments(props.work, new Date(props.now).toISOString())}>
      {(segment) => (
        <i
          data-who={segment.who}
          class={`block h-full ${WAITER_INK[segment.who].fill}`}
          style={{ width: `${segment.percent}%` }}
        />
      )}
    </For>
  </div>
);

export default WorkBar;
