/** Keyboard shortcut badge — consistent styling for keybind display. */

import { type Component, type JSX } from "solid-js";

const Kbd: Component<{
  children: JSX.Element;
  class?: string;
}> = (props) => (
  <kbd
    class={`text-xs font-mono text-fg-3 bg-surface-2 px-1.5 py-0.5 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)] ${props.class ?? ""}`}
  >
    {props.children}
  </kbd>
);

export default Kbd;
