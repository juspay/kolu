/** Teal pill badge for split affordances — visually distinct, works in dark and light modes. */

import type { Component, JSX } from "solid-js";

const SplitBadge: Component<{
  onClick: () => void;
  title: string;
  children: JSX.Element;
  "data-testid"?: string;
}> = (props) => (
  <button
    data-testid={props["data-testid"]}
    class="group px-3.5 py-1 rounded-full bg-gradient-to-b from-accent/30 to-accent/15 text-accent hover:from-accent/45 hover:to-accent/25 border border-accent/40 hover:border-accent/60 shadow-[0_1px_4px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-all duration-150 cursor-pointer text-xs font-semibold tracking-wide hover:scale-105 active:scale-95"
    onClick={(e) => {
      e.stopPropagation();
      props.onClick();
    }}
    title={props.title}
  >
    {props.children}
  </button>
);

export default SplitBadge;
