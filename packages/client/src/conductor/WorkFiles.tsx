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
 *  kolu's own copy once it has ended — and this draws whatever it answers.
 *  The card does not tell you which, which is the point of keeping them. */

import { type Component, For, Show } from "solid-js";
import type { WorkId } from "kolu-work";
import { openReader, readerTarget } from "./reader/useReader";
import { createWorkFiles, workFileName, type WorkFileSource } from "./workFile";

const WorkFiles: Component<{
  id: WorkId;
  /** Where this work's files come from — chosen once, by `workFile.ts`. */
  source: WorkFileSource;
  /** Whether what is listed is the copy kolu KEPT, which is the only thing
   *  the heading says differently. */
  kept: boolean;
}> = (props) => {
  const files = createWorkFiles(() => props.source);

  /** Which row is the one the reader has open — the card says so, so a person
   *  looking back at the column can see what they left open. */
  const open = (path: string): boolean => {
    const target = readerTarget();
    return target !== null && target.work === props.id && target.path === path;
  };

  return (
    <section data-testid="work-files" class="mt-2.5">
      <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
        {props.kept ? "Files (kept)" : "Files"}
      </h4>
      <Show
        when={files.rows().length > 0}
        fallback={
          <p class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3">
            {files.error() === undefined
              ? // A kept list is final: "yet" is only true of a work in
                // progress.
                props.kept
                ? "Nothing was written."
                : "Nothing written yet."
              : `Could not read the worktree — ${files.error()?.message}`}
          </p>
        }
      >
        <div class="mt-1 flex flex-wrap gap-1.5">
          <For each={files.rows()}>
            {(file) => (
              <button
                type="button"
                data-testid="work-file"
                data-path={file.path}
                data-open={open(file.path) ? "" : undefined}
                // A KEPT file is kolu's own copy of one the work wrote — the
                // worktree it came from may be gone.
                data-kept={props.source.at === null ? "" : undefined}
                // One press, one destination: the reader, on this file. The
                // row is not a toggle — a file you are reading is closed by
                // going back to the work, which is a button that says so.
                onClick={() => openReader({ work: props.id, path: file.path })}
                class={`max-w-full cursor-pointer truncate rounded-md border px-2 py-0.5 font-mono text-[0.62rem] ${
                  open(file.path)
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-edge-bright bg-surface-0 text-fg-2 hover:text-fg"
                }`}
              >
                {workFileName(file.path)}
                <Show when={file.note !== ""}>
                  <span class="text-fg-3"> · {file.note}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

export default WorkFiles;
