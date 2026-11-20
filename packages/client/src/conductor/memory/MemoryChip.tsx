/** THE HEADER'S MEMORY CHIP — "✱ Memory · 5", violet, while proposals wait
 *  on you, carrying how many; it opens the Memory sheet. Absent while
 *  nothing waits: the `⋯` menu's Memory row is the way in then. */

import { type Component, Show } from "solid-js";
import { memorySheet, useMemory } from "./useMemory";

const MemoryChip: Component = () => {
  const memory = useMemory();
  const waiting = () => memory.view().proposals.length;
  return (
    <Show when={waiting() > 0}>
      <button
        type="button"
        data-testid="conductor-memory-chip"
        data-waiting={waiting()}
        class="flex items-center gap-1 rounded-full border border-alert/60 bg-alert/10 px-2 py-px font-semibold text-alert cursor-pointer hover:bg-alert/20"
        onClick={() => memorySheet.openDialog()}
      >
        <span aria-hidden="true">✱</span>
        <span>Memory · {waiting()}</span>
      </button>
    </Show>
  );
};

export default MemoryChip;
