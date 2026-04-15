/** Labeled section with title and bottom border — shared across right panel tabs. */

import type { Component, JSX } from "solid-js";

const Section: Component<{
  title: string;
  /** Accent color class for the left border (e.g. "border-accent"). */
  accent?: string;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => (
  <div
    class={`py-3 px-3 border-b border-edge ${props.accent ? `border-l-2 ${props.accent}` : ""}`}
    data-testid={props["data-testid"]}
  >
    <div class="text-[9px] font-bold uppercase tracking-[0.15em] text-fg-3/60 mb-2">
      {props.title}
    </div>
    {props.children}
  </div>
);

export default Section;
