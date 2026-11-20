import type { Component, JSX } from "solid-js";

export const RowLabel: Component<{
  /** The annotation line, as markdown source. */
  markdown: string;
  render: (markdown: string) => JSX.Element;
  /** Size / flex utilities the surface adds on top of the shared class. */
  class: string;
  /** The per-branch annotation ink. Omitted where the surface paints the label
   *  from its own colour (the split row inherits `text-fg-2`). */
  color?: string;
}> = (props) => (
  <span
    class={`dock-cards-row-label ${props.class}`}
    style={props.color === undefined ? undefined : { color: props.color }}
  >
    {props.render(props.markdown)}
  </span>
);
