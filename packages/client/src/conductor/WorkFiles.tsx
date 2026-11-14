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
 *  While the work is in flight the list is LIVE, read from the member's
 *  worktree one level deep; when it has ended the list is what kolu kept, and
 *  the bytes come from kolu's own copy. The card does not tell you which —
 *  that is the point of keeping them. */

import { formatBytes } from "@kolu/byte-units";
import type { Work } from "kolu-work";
import {
  type Component,
  createMemo,
  createResource,
  For,
  Show,
} from "solid-js";
import { openReader, readerTarget } from "./reader/useReader";
import { listWorkFiles, type WorkPlace } from "./workFile";

const WorkFiles: Component<{
  work: Work;
  /** The member's worktree the live list is read from, or `null` when the
   *  work has ended (or no member has reported a worktree yet) — then the
   *  files are the ones kolu kept. */
  place: WorkPlace | null;
}> = (props) => {
  /** The LIVE list, re-read whenever the place moves. A failure is not a
   *  toast: a host that went away while a card was open is exactly the case
   *  where the kept copy is the answer, and the section says so in a line. */
  const [listed] = createResource(() => props.place, listWorkFiles);

  /** WHAT IS ON OFFER. In progress: whatever is in the worktree now. Ended:
   *  what kolu copied, with its size — the only list that still exists.
   *
   *  A failed read is read as the EMPTY list, never by touching `listed()`:
   *  a Solid resource RE-THROWS its failure at whoever reads it, and this
   *  memo is read inside the render — so a worktree kolu could not list took
   *  the whole page down with it ("kolu broke") instead of the one line below
   *  the section already has for saying so. */
  const files = createMemo(
    (): ReadonlyArray<{ path: string; note: string }> =>
      props.place === null
        ? props.work.keptFiles.map((kept) => ({
            path: kept.path,
            note: formatBytes(kept.bytes),
          }))
        : (listed.error === undefined ? (listed() ?? []) : []).map((path) => ({
            path,
            note: "",
          })),
  );

  /** Which row is the one the reader has open — the card says so, so a person
   *  looking back at the column can see what they left open. */
  const open = (path: string): boolean => {
    const target = readerTarget();
    return (
      target !== null && target.work === props.work.id && target.path === path
    );
  };

  return (
    <section data-testid="work-files" class="mt-2.5">
      <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
        {props.work.endedAt !== null ? "Files (kept)" : "Files"}
      </h4>
      <Show
        when={files().length > 0}
        fallback={
          <p class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3">
            {listed.error === undefined
              ? "Nothing written yet."
              : `Could not read the worktree — ${listed.error.message}`}
          </p>
        }
      >
        <div class="mt-1 flex flex-wrap gap-1.5">
          <For each={files()}>
            {(file) => (
              <button
                type="button"
                data-testid="work-file"
                data-path={file.path}
                data-open={open(file.path) ? "" : undefined}
                // A KEPT file is kolu's own copy of one the work wrote — the
                // worktree it came from may be gone.
                data-kept={props.place === null ? "" : undefined}
                // One press, one destination: the reader, on this file. The
                // row is not a toggle — a file you are reading is closed by
                // going back to the work, which is a button that says so.
                onClick={() =>
                  openReader({ work: props.work.id, path: file.path })
                }
                class={`max-w-full cursor-pointer truncate rounded-md border px-2 py-0.5 font-mono text-[0.62rem] ${
                  open(file.path)
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-edge-bright bg-surface-0 text-fg-2 hover:text-fg"
                }`}
              >
                {file.path.replace(/^\.waterfall\//, "")}
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
