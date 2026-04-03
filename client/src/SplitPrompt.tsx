/** SplitPrompt — affordance strip at the bottom of a terminal with no splits.
 *  Shows "+ Split" with a keyboard shortcut hint. Click creates the first split. */

import type { Component } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Kbd from "./Kbd";

const SplitPrompt: Component<{
  onCreate: () => void;
}> = (props) => {
  return (
    <button
      data-testid="split-prompt"
      class="flex items-center justify-center gap-3 w-full h-6 shrink-0
             bg-surface-1 border-t border-edge text-[11px] font-mono
             opacity-50 hover:opacity-100 hover:border-edge-bright
             transition-all cursor-pointer"
      onClick={props.onCreate}
    >
      <span>
        <span class="text-accent font-medium">+</span>{" "}
        <span class="text-fg-3">Split</span>
      </span>
      <Kbd>{formatKeybind(SHORTCUTS.toggleSubPanel.keybind)}</Kbd>
    </button>
  );
};

export default SplitPrompt;
