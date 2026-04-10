/** SplitStrip — affordance strip for split terminal discoverability.
 *  "prompt" when no splits exist yet, "collapsed" when splits are hidden. */

import type { Component } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Kbd from "./Kbd";

type SplitStripProps =
  | { variant: "prompt"; onClick: () => void }
  | { variant: "collapsed"; count: number; onClick: () => void };

const SplitStrip: Component<SplitStripProps> = (props) => {
  const isCollapsed = () => props.variant === "collapsed";
  const count = () => (isCollapsed() ? (props as { count: number }).count : 0);

  return (
    <button
      data-testid={isCollapsed() ? "collapsed-indicator" : "split-prompt"}
      class="flex items-center justify-center gap-3 w-full h-6 shrink-0
             text-[11px] font-mono transition-all cursor-pointer"
      classList={{
        "bg-surface-2 border-t border-edge-bright hover:bg-surface-3":
          !isCollapsed(),
        "bg-surface-1 border-t border-accent hover:brightness-110":
          isCollapsed(),
      }}
      aria-label={
        isCollapsed()
          ? `${count()} split terminal${count() > 1 ? "s" : ""} (Ctrl+\`)`
          : "Split terminal"
      }
      onClick={props.onClick}
    >
      <span class="text-accent font-medium">{isCollapsed() ? "▸" : "+"}</span>
      <span class="text-fg-3">
        {isCollapsed() ? `${count()} split${count() > 1 ? "s" : ""}` : "Split"}
      </span>
      <Kbd>{formatKeybind(SHORTCUTS.toggleSubPanel.keybind)}</Kbd>
    </button>
  );
};

export default SplitStrip;
