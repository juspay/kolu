/** A PIECE OF WORK, NAMED — the one drawing of a work's name outside its own
 *  card, and only three things: a dot for who the work is waiting on (the
 *  standing line's colour; violet, and pulsing, when it is you), or the
 *  finished colour once it is over; the work's title; and the repository's
 *  name, the word the card's subtitle says, in quiet ink after it. A watch has
 *  no repository: its chip is the dot and the title.
 *
 *  It reads nothing but the work's own record: who a work waits on is a fold
 *  over that record (`waiterOf`), so a chip cannot say something about a work
 *  its card does not. What its terminals are doing is read on the hover card
 *  `WorkChip` opens over it, not on the chip.
 *
 *  Not interactive by itself. `WorkChip` wraps it in the button that brings
 *  the work into view, with the hover card; a "which work?" menu draws it
 *  inside its own option button; a window with nowhere to bring a work into
 *  (the reader popped out on its own) draws it as it is. */

import type { Work } from "kolu-work";
import { type Component, Show } from "solid-js";
import { repoName, WORK_DOT, waiterOf } from "./workReadings";

const WorkChipFace: Component<{ work: Work }> = (props) => {
  const who = () => waiterOf(props.work);
  const repo = () => {
    const key = props.work.key;
    return key.kind === "branch" ? repoName(key.repo) : null;
  };
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
      <span data-testid="work-chip-title" class="min-w-0 max-w-[36ch] truncate">
        {props.work.title}
      </span>
      {/* THE TITLE GIVES WAY LAST. In a box too small for both, the repo is
          what shrinks, and it is gone before the title loses a letter. */}
      <Show when={repo()}>
        {(name) => (
          <span
            data-testid="work-chip-repo"
            class="min-w-0 shrink-[999] truncate font-normal text-fg-3"
          >
            {name()}
          </span>
        )}
      </Show>
    </span>
  );
};

export default WorkChipFace;
