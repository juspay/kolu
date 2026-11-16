/** THE CONDUCTOR'S PROSE — one agent line, rendered as Markdown, with its
 *  long lists folded and the files it names made into links.
 *
 *  Everything about the rendering itself belongs to `@kolu/solid-markdown`;
 *  this adds the two Conductor rules the package has no business holding:
 *
 *   - A list of more than five items shows its first three and a line that
 *     opens the rest (see ./proseListFold for why it stays here).
 *   - A FILE THE CONDUCTOR NAMES OPENS. An inline code span whose text is
 *     exactly a path of a work kolu holds (./namedFiles) is a button that
 *     opens the reader on it, as the card's row does, and reads as open while
 *     the reader is on it. One work holds it: it opens. Several do: the press
 *     offers them by title, and the person chooses — nothing guesses which one
 *     a sentence meant. A path no work holds stays plain code. Derived from
 *     the live works, never stored in the row, so a file written after the
 *     sentence turns its mention into a link by itself.
 *
 *  THE ORDER MATTERS, and it is Solid's, not a timer's. The package writes the
 *  prose through an `innerHTML` binding, which is a RENDER effect — those run
 *  in the update's pure phase, before the user effects queued below. So by the
 *  time the effect here runs, on the first paint and on every streamed chunk
 *  alike, the DOM it folds is the DOM the reader is about to see. Nothing is
 *  deferred, observed or polled.
 *
 *  The effect re-runs for three reasons and all are reads: the row's text (a
 *  chunk replaced the prose, so the fold must be re-applied), what the links
 *  answer (a file appeared, or the reader moved — the prose was re-rendered),
 *  and the open state of the lists `applyProseListFold` touches (somebody
 *  pressed "and N more"). */

import { type InlineCodeAction, Markdown } from "@kolu/solid-markdown";
import type { WorkId } from "kolu-work";
import { type Component, createEffect, createSignal } from "solid-js";
import { OptionMenu } from "../ui/OptionMenu";
import { type FileHolder, worksHolding } from "./namedFiles";
import { applyProseListFold } from "./proseListFold";
import { openReader, readerTarget } from "./reader/useReader";
import { useWorkMap } from "./useWorks";

const ConductorProse: Component<{
  /** The transcript row this prose belongs to — what its folds are remembered
   *  under, so an opened list survives the row object being replaced. */
  rowId: string;
  /** The agent's Markdown, as it stands this chunk. */
  text: string;
}> = (props) => {
  let host!: HTMLDivElement;
  const works = useWorkMap();

  /** A file named by several works, waiting on the person's choice — and the
   *  link they pressed, which the choice is anchored to. */
  const [choosing, setChoosing] = createSignal<{
    readonly anchor: HTMLElement;
    readonly path: string;
    readonly holders: ReadonlyArray<FileHolder>;
  } | null>(null);

  /** What a code span is, as a link: none for a path no work holds. Open
   *  ("current") only when exactly one work holds it and the reader is on
   *  that work's file — with several, the span names no one file. */
  const action = (path: string): InlineCodeAction | undefined => {
    const holders = worksHolding(works(), path);
    const [only, ...more] = holders;
    if (only === undefined) return undefined;
    const open = readerTarget();
    return {
      label: `Open ${path}`,
      current:
        more.length === 0 &&
        open !== null &&
        open.work === only.work &&
        open.path === path,
    };
  };

  const press = (path: string, anchor: HTMLElement): void => {
    const holders = worksHolding(works(), path);
    const [only, ...more] = holders;
    if (only === undefined) return;
    if (more.length === 0) {
      openReader({ work: only.work, path });
      return;
    }
    setChoosing({ anchor, path, holders });
  };

  createEffect(() => {
    // Read the text to re-fold a prose that has just been rewritten, and what
    // the links read to re-fold one re-rendered for a new link; the pass
    // itself reads the open state, so a press re-runs this too.
    void props.text;
    void works();
    void readerTarget();
    applyProseListFold(host, props.rowId);
  });

  // `min-w-0`: this sits inside the transcript's flex column, where a child
  // floors at its content width unless released — one unbroken line in the
  // prose would otherwise widen the whole conversation.
  return (
    <div ref={host} class="min-w-0">
      <Markdown
        markdown={props.text}
        variant="compact"
        inlineCode={{ action, onPress: press }}
      />
      <OptionMenu<WorkId>
        triggerRef={() => choosing()?.anchor}
        open={() => choosing() !== null}
        onDismiss={() => setChoosing(null)}
        anchor="bottom-start"
        options={(choosing()?.holders ?? []).map((one) => ({
          value: one.work,
          label: one.title,
        }))}
        value={"" as WorkId}
        onSelect={(work) => {
          const path = choosing()?.path;
          setChoosing(null);
          if (path !== undefined) openReader({ work, path });
        }}
        testIdPrefix="named-file"
        truncate
        flip
      />
    </div>
  );
};

export default ConductorProse;
