/** Floating "scroll to bottom" button — shown when terminal is scroll-locked. */

import { type Component, Show } from "solid-js";

const ScrollToBottom: Component<{
  visible: boolean;
  onClick: () => void;
}> = (props) => (
  <Show when={props.visible}>
    <button
      data-testid="scroll-to-bottom"
      class="absolute bottom-3 right-3 z-10 bg-surface-1 border border-edge-bright rounded-full shadow-lg p-2 text-fg-3 hover:text-fg transition-colors cursor-pointer"
      onClick={props.onClick}
      aria-label="Scroll to bottom"
    >
      <svg
        class="w-4 h-4"
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
  </Show>
);

export default ScrollToBottom;
