/** A PIECE OF WORK, NAMED — the one drawing of a work's name outside its own
 *  card: a dot for who the work is waiting on (the standing line's colour;
 *  violet, and pulsing, when it is you), or the finished colour once it is
 *  over, and the work's title.
 *
 *  Not interactive by itself. `WorkChip` wraps it in the button that brings
 *  the work into view; a "which work?" menu draws it inside its own option
 *  button; a window with nowhere to bring a work into (the reader popped out
 *  on its own) draws it as it is. */

import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, createMemo } from "solid-js";
import { standingLine, WORK_DOT } from "./workReadings";

const WorkChipFace: Component<{ work: Work }> = (props) => {
  /** Who the dot is for — the reading the card's standing line makes,
   *  without the live check tally the dot has no use for. */
  const who = createMemo(() => standingLine(props.work, Option.none()).who);
  return (
    <span
      data-testid="work-chip-face"
      data-who={who()}
      class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-edge-bright bg-surface-0 py-px pe-2 ps-1.5 align-baseline font-sans text-[0.72rem] font-medium text-fg"
    >
      <span
        aria-hidden="true"
        class={`h-2 w-2 shrink-0 rounded-full ${WORK_DOT[who()]}`}
      />
      <span class="min-w-0 max-w-[36ch] truncate">{props.work.title}</span>
    </span>
  );
};

export default WorkChipFace;
