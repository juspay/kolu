/** Floating "scroll to bottom" button — shown when terminal is scroll-locked. */

import { type Component, Show } from "solid-js";
import { ScrollDownIcon } from "../ui/Icons";
import Tip from "../ui/Tip";

const ScrollToBottom: Component<{
  visible: boolean;
  /** New output has arrived while scroll-locked. */
  active: boolean;
  onClick: () => void;
}> = (props) => (
  <Show when={props.visible}>
    <Tip label="Scroll to bottom">
      <button
        type="button"
        data-testid="scroll-to-bottom"
        data-active={props.active ? "" : undefined}
        class="absolute bottom-6 right-6 z-10 rounded-full shadow-lg p-3 transition-colors cursor-pointer"
        classList={{
          // Active: accent border + accent text for high contrast
          "bg-surface-1 border-2 border-accent text-accent": props.active,
          "bg-surface-1 border border-edge-bright text-fg-3 hover:text-fg":
            !props.active,
        }}
        onClick={props.onClick}
        aria-label="Scroll to bottom"
      >
        {/* Expanding ring animation — draws attention to new output below */}
        <Show when={props.active}>
          <span class="absolute inset-0 rounded-full bg-accent/20 animate-ping" />
        </Show>
        <ScrollDownIcon class="w-5 h-5 relative" />
      </button>
    </Tip>
  </Show>
);

export default ScrollToBottom;
