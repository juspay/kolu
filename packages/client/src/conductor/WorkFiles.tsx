/** THE WORK'S FILES — what the agents wrote, LISTED on the card and read in
 *  the reader.
 *
 *  A plan is the thing a person actually wants to read off a card, and for a
 *  while it was drawn inside it: a box in the right-hand column, eighty
 *  pixels less than the column was wide. That is the smallest box on the
 *  screen for the one document somebody has to read before they approve it —
 *  a table in it came out one word a line, because a table's columns can
 *  never be narrower than their longest word and the box left them nothing
 *  else. So the card is now a LIST, and pressing a row opens the reader
 *  (`reader/WorkReader.tsx`), which takes the large side of the screen.
 *
 *  WHERE THE ROWS COME FROM IS NOT THIS COMPONENT'S QUESTION. `workFile.ts`
 *  chooses the source once — the member's worktree while a work is in flight,
 *  kolu's own copy once it has ended — and this draws whatever it answers,
 *  through the one chip list the reader's tabs draw too (`WorkFileList.tsx`).
 *  The card does not tell you which, which is the point of keeping them.
 *
 *  WHAT WAS NOT KEPT is said under the chips: the one sentence the work's
 *  ending recorded (a file past the size kolu keeps, a listing cut short, or
 *  a copy that failed outright), so "Nothing was written" is never said of a
 *  work whose files kolu could not keep. */

import { toError } from "@kolu/surface/run-stream";
import type { WorkId } from "kolu-work";
import { type Component, Errored, Show } from "solid-js";
import { openReader, readerTarget } from "./reader/useReader";
import WorkFileList from "./WorkFileList";
import { createWorkFiles, type WorkFileSource } from "./workFile";

const WorkFiles: Component<{
  id: WorkId;
  /** Where this work's files come from — chosen once, by `workFile.ts`. */
  source: WorkFileSource;
  /** Whether what is listed is the copy kolu KEPT, which is the only thing
   *  the heading says differently. */
  kept: boolean;
  /** Why some (or all) of the files were not kept when the work ended —
   *  undefined while it is open, and when nothing was left out. */
  notKept: string | undefined;
}> = (props) => {
  const files = createWorkFiles(() => props.source);

  /** Which file the reader has open, if it is one of this work's — the card
   *  says so, so a person looking back at the column can see what they left
   *  open. */
  const openTo = (): string | undefined => {
    const target = readerTarget();
    return target !== null && target.work === props.id
      ? target.path
      : undefined;
  };

  return (
    <section data-testid="work-files" class="mt-2.5">
      <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
        {props.kept ? "Files (kept)" : "Files"}
      </h4>
      {/* A WORKTREE KOLU COULD NOT LIST is one line, not a dead card: the
          listing throws its failure at this read, and this boundary is what
          catches it. Its fallback stands in for the whole list — on a failed
          listing there are no rows to draw anyway. */}
      <Errored
        fallback={(why) => (
          <Show when={props.notKept === undefined}>
            <p class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3">
              Could not read the worktree — {toError(why()).message}
            </p>
          </Show>
        )}
      >
        <Show
          when={files.rows().length > 0}
          fallback={
            <Show when={props.notKept === undefined}>
              <p class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3">
                {/* A kept list is final: "yet" is only true of a work in
                    progress. */}
                {props.kept ? "Nothing was written." : "Nothing written yet."}
              </p>
            </Show>
          }
        >
          <WorkFileList
            rows={files.rows()}
            more={files.more()}
            openTo={openTo()}
            layout="wrap"
            onOpen={(path) => openReader({ work: props.id, path })}
          />
        </Show>
      </Errored>
      <Show when={props.notKept}>
        {(why) => (
          <p
            data-testid="work-files-not-kept"
            class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3"
          >
            Not kept: {why()}
          </p>
        )}
      </Show>
    </section>
  );
};

export default WorkFiles;
