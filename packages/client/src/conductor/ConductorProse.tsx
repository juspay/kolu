/** THE CONDUCTOR'S PROSE — one agent line, rendered as Markdown, with its
 *  long lists folded.
 *
 *  Everything about the rendering itself belongs to `@kolu/solid-markdown`;
 *  this adds the one Conductor rule the package has no business holding (see
 *  ./proseListFold for why it stays here): a list of more than five items
 *  shows its first three and a line that opens the rest.
 *
 *  THE ORDER MATTERS, and it is Solid's, not a timer's. The package writes the
 *  prose through an `innerHTML` binding, which is a RENDER effect — those run
 *  in the update's pure phase, before the user effects queued below. So by the
 *  time the effect here runs, on the first paint and on every streamed chunk
 *  alike, the DOM it folds is the DOM the reader is about to see. Nothing is
 *  deferred, observed or polled.
 *
 *  The effect re-runs for two reasons and both are reads: the row's text (a
 *  chunk replaced the prose, so the fold must be re-applied) and the open
 *  state of the lists `applyProseListFold` touches (somebody pressed "and N
 *  more"). */

import { Markdown } from "@kolu/solid-markdown";
import { type Component, createEffect } from "solid-js";
import { applyProseListFold } from "./proseListFold";

const ConductorProse: Component<{
  /** The transcript row this prose belongs to — what its folds are remembered
   *  under, so an opened list survives the row object being replaced. */
  rowId: string;
  /** The agent's Markdown, as it stands this chunk. */
  text: string;
}> = (props) => {
  let host!: HTMLDivElement;

  createEffect(() => {
    // Read the text to re-fold a prose that has just been rewritten; the pass
    // itself reads the open state, so a press re-runs this too.
    void props.text;
    applyProseListFold(host, props.rowId);
  });

  // `min-w-0`: this sits inside the transcript's flex column, where a child
  // floors at its content width unless released — one unbroken line in the
  // prose would otherwise widen the whole conversation.
  return (
    <div ref={host} class="min-w-0">
      <Markdown markdown={props.text} variant="compact" />
    </div>
  );
};

export default ConductorProse;
