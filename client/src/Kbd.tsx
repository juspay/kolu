/** Keyboard shortcut badge — consistent keycap styling across the app. */

import { type Component, type JSX } from "solid-js";

const Kbd: Component<{
  children: JSX.Element;
  class?: string;
}> = (props) => (
  <kbd
    class={`inline-flex items-center justify-center min-w-[1.5em] px-1.5 py-0.5 text-[0.7rem] font-mono leading-none text-fg-2 bg-surface-2 rounded-md border border-edge-bright border-b-[2px] shadow-[0_1px_1px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] ${props.class ?? ""}`}
  >
    {props.children}
  </kbd>
);

export default Kbd;
