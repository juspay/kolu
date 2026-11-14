/** THE WORK'S FILES — what the agents wrote, opened IN PLACE.
 *
 *  A plan is the thing a person actually wants to read off a card, and the
 *  worst version of that is a link that takes you somewhere else. So a file
 *  opens here, under the list, rendered — and rendered by the SAME viewer the
 *  Code tab uses (`BrowseFileDispatcher`: kolu's markdown, images, HTML
 *  sandbox, and its comments-on-files), not by a second one that would start
 *  identical and drift by a release.
 *
 *  While the work is in flight the list is LIVE, read from the member's
 *  worktree one level deep; when it has ended the list is what kolu kept, and
 *  the bytes come from kolu's own copy. The card does not tell you which —
 *  that is the point of keeping them. */

import { formatBytes } from "@kolu/byte-units";
import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import type { Work } from "kolu-work";
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import BrowseFileDispatcher from "../right-panel/BrowseFileDispatcher";
import { useColorScheme } from "../settings/useColorScheme";
import {
  listWorkFiles,
  readKeptFile,
  readWorkFile,
  type WorkPlace,
} from "./workFile";

const WorkFiles: Component<{
  work: Work;
  /** The member's worktree the live list is read from, or `null` when the
   *  work has ended (or no member has reported a worktree yet) — then the
   *  files are the ones kolu kept. */
  place: WorkPlace | null;
}> = (props) => {
  const { themeTypeLiteral: theme } = useColorScheme();
  const [open, setOpen] = createSignal<string | null>(null);

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

  /** THE OPEN FILE'S BYTES. Keyed on the path AND the place, so opening a
   *  second file reads it and a work that ends while its card is open falls
   *  back to the kept copy without the reader doing anything. */
  const [bytes] = createResource(
    (): { path: string; place: WorkPlace | null; work: string } | null => {
      const path = open();
      return path === null
        ? null
        : { path, place: props.place, work: props.work.id };
    },
    (target): Promise<FileWithSource | FileWithUrl> =>
      target.place === null
        ? readKeptFile(target.work, target.path)
        : readWorkFile(target.place, target.path),
  );

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
                data-open={open() === file.path ? "" : undefined}
                // A KEPT file is kolu's own copy of one the work wrote — the
                // worktree it came from may be gone.
                data-kept={props.place === null ? "" : undefined}
                // Pressing the open file closes it: the list is a toggle, so
                // a reader can put the card back the way they found it.
                onClick={() =>
                  setOpen((was) => (was === file.path ? null : file.path))
                }
                class={`max-w-full cursor-pointer truncate rounded-md border px-2 py-0.5 font-mono text-[0.62rem] ${
                  open() === file.path
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
      {/* IN PLACE, and sized: the viewer fills a band under the list rather
          than the card, so a 900-line plan scrolls inside the card instead of
          pushing every other work off the column. */}
      <Show when={open()}>
        {(path) => (
          <div
            data-testid="work-file-view"
            data-path={path()}
            class="mt-1.5 flex h-80 min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-0"
          >
            <BrowseFileDispatcher
              // A kept file is kolu's own copy: no repo behind it, so no
              // terminal to anchor a comment or resolve a link against.
              at={
                props.place === null
                  ? null
                  : {
                      host: props.place.host,
                      terminalId: props.place.terminalId,
                    }
              }
              filePath={path()}
              // Same rule as the list above: a resource RE-THROWS its failure
              // at its reader, and `error` beside it is how the viewer is told
              // — so the value is only read when there is one.
              file={bytes.error === undefined ? (bytes() ?? null) : null}
              error={bytes.error}
              // The work's OWN files are the vault a `[[wikilink]]` in a plan
              // resolves against — the only list this card has, and the list
              // a plan's links actually point into.
              repoVault={{
                paths: files().map((file) => file.path),
                pending: listed.loading,
              }}
              theme={theme()}
            />
          </div>
        )}
      </Show>
    </section>
  );
};

export default WorkFiles;
