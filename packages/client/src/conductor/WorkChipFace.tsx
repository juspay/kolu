/** A PIECE OF WORK, NAMED — the one drawing of a work's name outside its own
 *  card: a dot for who the work is waiting on (the standing line's colour;
 *  violet, and pulsing, when it is you), or the finished colour once it is
 *  over; the work's title; the Dock's status mark for each of its terminals,
 *  three at most; its PR pip while a member's record carries the PR live; and,
 *  only while the work waits on you, the Dock's violet chip saying for how
 *  long.
 *
 *  Every part is read by the readings the work's card and its sidebar line
 *  read (`createWorkFacts`), so a chip cannot say something about a work its
 *  card does not.
 *
 *  Not interactive by itself, so nothing in it is a link: the PR pip is the
 *  Dock's marks without the Dock's link (`PrPipFace`). `WorkChip` wraps it in
 *  the button that brings the work into view, with the hover card; a "which
 *  work?" menu draws it inside its own option button; a window with nowhere to
 *  bring a work into (the reader popped out on its own) draws it as it is. */

import { PrPipFace } from "@kolu/solid-dockrow";
import { recencyText } from "@kolu/solid-dockrow/rowValues";
import { NeedsYouCapsule } from "@kolu/solid-statepip";
import type { Work, WorkId } from "kolu-work";
import { type Component, Show } from "solid-js";
import { useShownClock } from "../ui/shown";
import MemberMarks from "./MemberMarks";
import { createWorkFacts } from "./workFacts";
import { WORK_DOT } from "./workReadings";

const WorkChipFace: Component<{
  /** The id the work is filed under — what its terminals are read by. */
  id: WorkId;
  work: Work;
}> = (props) => {
  const now = useShownClock();
  const { members, livePr, at } = createWorkFacts(
    () => props.id,
    () => props.work,
  );
  return (
    <span
      data-testid="work-chip-face"
      data-who={at().who}
      class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-edge-bright bg-surface-0 py-px pe-2 ps-1.5 align-baseline font-sans text-[0.72rem] font-medium text-fg"
    >
      <span
        aria-hidden="true"
        class={`h-2 w-2 shrink-0 rounded-full ${WORK_DOT[at().who]}`}
      />
      <span class="min-w-0 max-w-[36ch] truncate">{props.work.title}</span>
      <MemberMarks members={members()} />
      <PrPipFace pr={livePr()} />
      <Show when={at().who === "you"}>
        <NeedsYouCapsule
          testid="work-chip-wait"
          title="How long this work has waited on you"
        >
          {recencyText("wait-chip", Date.parse(at().since), now())}
        </NeedsYouCapsule>
      </Show>
    </span>
  );
};

export default WorkChipFace;
