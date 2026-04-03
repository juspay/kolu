/** Affordance bar at the bottom of a terminal — click to create the first split. */

import type { Component } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";

const SplitBar: Component<{ onClick: () => void }> = (props) => (
  <button
    data-testid="split-bar"
    class="shrink-0 h-6 w-full flex items-center justify-center gap-1.5 bg-surface-0 border-t border-edge text-fg-3 hover:text-fg hover:bg-surface-1 transition-colors cursor-pointer text-xs"
    onClick={props.onClick}
    title={`Split terminal (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
  >
    <span>+</span>
    <span>Split</span>
  </button>
);

export default SplitBar;
