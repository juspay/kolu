/** Label–value pair with dim label and bright value.
 *  `variant` codifies styling rules for special rows:
 *  - "badge": pill background for status indicators
 *  - "tag": mono accent background for identity values */

import type { Component, JSX } from "solid-js";

const Row: Component<{
  label: string;
  variant?: "default" | "badge" | "tag";
  children: JSX.Element;
}> = (props) => (
  <div class="flex items-baseline gap-3 text-[11px] leading-snug py-0.5">
    <span class="text-fg-3/70 shrink-0 w-14 text-right">{props.label}</span>
    <span
      class={`min-w-0 break-words ${
        props.variant === "badge"
          ? "text-fg-2 inline-flex items-center gap-1.5 bg-surface-2/60 px-1.5 py-px rounded-full text-[10px]"
          : props.variant === "tag"
            ? "text-fg font-mono bg-accent/10 px-1.5 py-px rounded-sm text-[10px]"
            : "text-fg-2"
      }`}
    >
      {props.children}
    </span>
  </div>
);

export default Row;
