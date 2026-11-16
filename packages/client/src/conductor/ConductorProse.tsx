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
 *  THE TRIGGER IS THE PACKAGE'S, not the text's. The prose's DOM is rewritten
 *  whenever the package writes rendered HTML — a streamed chunk, but also a
 *  diagram landing in text that did not change — and every rewrite throws the
 *  fold away. So the fold is re-applied from `<Markdown onRendered>`, which
 *  the package calls after EVERY such write, once the DOM is in place and in
 *  the same update: the DOM it folds is the DOM the reader is about to see.
 *  Nothing is deferred, observed or polled.
 *
 *  The fold effect re-runs for two reasons and both are reads: the rewrite
 *  count `onRendered` bumps (the prose was replaced — a chunk, a diagram
 *  landing, a link appearing or the reader moving — so the fold must be
 *  re-applied, and the lists it must watch may be new ones), and the open
 *  state of the lists `applyProseListFold` touches (somebody pressed "and N
 *  more"). */

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
  /** The prose's DOM was rewritten — a chunk, a diagram landing (which grows
   *  the row with no new text), a named file becoming a link. Whether the text
   *  changed is not asked here: the closing-fence chunk renders the same HTML
   *  as the chunk before it, so the text a rewrite carries cannot tell what
   *  caused it. Never called for a press on "and N more", which writes no
   *  HTML. */
  onRedrawn?: () => void;
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

  const [rewrites, setRewrites] = createSignal(0);

  createEffect(() => {
    rewrites();
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
        onRendered={() => {
          // The fold is queued first, so a transcript re-pinning on
          // `onRedrawn` measures the folded row.
          setRewrites((n) => n + 1);
          props.onRedrawn?.();
        }}
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
