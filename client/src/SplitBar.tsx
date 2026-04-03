/** Floating split badge at the bottom of a terminal — click to create the first split. */

import type { Component } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import SplitBadge from "./SplitBadge";

const SplitBar: Component<{ onClick: () => void }> = (props) => (
  <div class="absolute bottom-2 left-0 right-0 z-20 flex justify-center pointer-events-none">
    <div class="pointer-events-auto">
      <SplitBadge
        data-testid="split-bar"
        onClick={props.onClick}
        title={`Split terminal (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
      >
        + Split
      </SplitBadge>
    </div>
  </div>
);

export default SplitBar;
