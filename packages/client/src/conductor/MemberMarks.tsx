/** A WORK'S TERMINALS, AS MARKS — the Dock's status mark for each member
 *  terminal (`MemberPip`), three at most, then how many more. Drawn on a work's
 *  line in the sidebar and on its chip, which name a work in a few words and
 *  have room for no more than that. */

import { type Component, For, Show } from "solid-js";
import MemberPip from "./MemberPip";
import type { MemberLine } from "./workFacts";

/** How many terminals' marks are drawn before the rest are counted. */
const SHOWN = 3;

const MemberMarks: Component<{ members: ReadonlyArray<MemberLine> }> = (
  props,
) => (
  <>
    {/* Keyed by the terminal's ref: a mark stays the same element while its
        terminal's record moves. */}
    <For each={props.members.slice(0, SHOWN)} keyed={(one) => one.terminal}>
      {(one) => (
        <Show when={one().split}>
          {(ref) => <MemberPip at={ref()} standing={one().standing} />}
        </Show>
      )}
    </For>
    <Show when={props.members.length > SHOWN}>
      <span
        data-testid="member-marks-more"
        class="shrink-0 font-mono text-[0.58rem] text-fg-3"
      >
        +{props.members.length - SHOWN}
      </span>
    </Show>
  </>
);

export default MemberMarks;
