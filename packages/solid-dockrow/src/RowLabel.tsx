/** The row's ANNOTATION slot — the branch name, or line 1 of the user's intent
 *  when they set one.
 *
 *  `.dock-cards-row-label` (in `dockrow.css`) carries the whole rule: the denser
 *  weight that makes the primary line read as the row title, the `min-width:0` +
 *  ellipsis that keeps a long intent from blowing the grid track, AND the
 *  weight-700 lift a blocked or unread row gets. Three of its six rules used to
 *  be re-spelled as Tailwind utilities on one surface, which is how the surface
 *  literally named "Needs you" ended up rendering plainer than every row it
 *  mirrors. One class, every surface.
 *
 *  `render` is REQUIRED and injected. The label is markdown, and this package
 *  deliberately ships no markdown engine: a renderer costs a consumer `marked`,
 *  `dompurify`, `shiki` and `yaml` in its manifest closure — real weight nothing
 *  else here needs — and rendering rules (sanitisation, link policy, inline vs
 *  block) are a different volatility from row layout. So the decision is the
 *  consumer's and it is a decision, not a silent default: kolu passes its
 *  inline intent renderer, and a consumer that wants plain text passes
 *  `(md) => md`. */

import type { Component, JSX } from "solid-js";

export const RowLabel: Component<{
  /** The annotation line, as markdown source. */
  markdown: string;
  /** Renders it. See the module header for why this is injected. */
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
