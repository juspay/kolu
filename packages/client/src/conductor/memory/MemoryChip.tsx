/** THE HEADER'S MEMORY CHIP — "✱ 5", violet, while proposals wait on you,
 *  carrying how many; it opens the Memory sheet. Absent while nothing waits:
 *  the `⋯` menu's Memory row is the way in then.
 *
 *  The mark and the count alone, on one line that never shrinks: the header
 *  heads a chat panel of fixed measure (21rem on a narrow desktop), and a
 *  word in it would push the help's `?` and the `⋯` menu off the row. What
 *  it is, it says on hover and to a screen reader. */

import { type Component, Show } from "solid-js";
import Tip from "../../ui/Tip";
import { memorySheet, useMemory } from "./useMemory";

const MemoryChip: Component = () => {
  const memory = useMemory();
  const waiting = () => memory.view().proposals.length;
  const says = () =>
    waiting() === 1
      ? "1 memory proposal waiting on you"
      : `${waiting()} memory proposals waiting on you`;
  return (
    <Show when={waiting() > 0}>
      <Tip class="flex shrink-0 items-center" label={says()}>
        <button
          type="button"
          data-testid="conductor-memory-chip"
          data-waiting={waiting()}
          aria-label={`${says()}: open the Memory sheet`}
          class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-alert/60 bg-alert/10 px-2 py-px font-semibold text-alert cursor-pointer hover:bg-alert/20"
          onClick={() => memorySheet.openDialog()}
        >
          <span aria-hidden="true">✱</span>
          <span class="tabular-nums">{waiting()}</span>
        </button>
      </Tip>
    </Show>
  );
};

export default MemoryChip;
