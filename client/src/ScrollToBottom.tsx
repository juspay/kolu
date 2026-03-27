/** Floating "scroll to bottom" button — shown when terminal is scroll-locked. */

import { type Component, Show } from "solid-js";
import Tip from "./Tip";

const ScrollToBottom: Component<{
  visible: boolean;
  /** New output has arrived while scroll-locked. */
  active: boolean;
  onClick: () => void;
}> = (props) => (
  <Show when={props.visible}>
    <Tip label="Scroll to bottom">
      <button
        data-testid="scroll-to-bottom"
        data-active={props.active ? "" : undefined}
        class="absolute bottom-6 right-6 z-10 bg-surface-1 border border-edge-bright rounded-full shadow-lg p-3 text-fg-3 hover:text-fg transition-colors cursor-pointer"
        onClick={props.onClick}
        aria-label="Scroll to bottom"
      >
        {/* Gentle pulse when new output arrives below */}
        <Show when={props.active}>
          <span class="absolute inset-0 rounded-full border-2 border-accent animate-pulse" />
        </Show>
        <svg
          class="w-5 h-5 relative"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      </button>
    </Tip>
  </Show>
);

export default ScrollToBottom;
