/** THE READER — a work's file, given the large side of the screen.
 *
 *  A plan is the one thing a person has to read before they approve it, and
 *  the worst place to read it is a box in the corner of a card. So a file row
 *  opens HERE: about two thirds of the Conductor's screen, with the
 *  conversation beside it (`ConductorPane.tsx` owns that frame), the question
 *  about the work pinned above the document, and "← Work" to put the cards
 *  back exactly as they were.
 *
 *  ONE VIEWER, NOT A SECOND ONE. The document is drawn by
 *  `BrowseFileDispatcher` — kolu's markdown, its images, its HTML sandbox and
 *  its comments-on-files, the same renderers the Code tab uses — so the
 *  Rendered ⇄ Source toggle at the document's head is that component's, not a
 *  second control here that would start identical and drift by a release.
 *  What this adds around it is the reading FRAME: the work's other files as
 *  tabs, the question, and the two ways to give the document more room.
 *
 *  THE DOCUMENT IS SET FOR READING — a column of
 *  `--container-conductor-reader` at 16px with a generous line height, with
 *  tables and code blocks free to use the pane's full width and scroll
 *  sideways rather than squeeze (the `.reader-doc` rules in `index.css`). The
 *  squeeze is not a style question: a table's columns can never be narrower
 *  than their longest word, so a table in a 430px card is a table with one
 *  word a line.
 *
 *  TWO PLACEMENTS, one component. `pane` is the two-thirds reader beside the
 *  conversation (and the whole pane on a narrow window or a phone); `window`
 *  is the pop-out on its own route, which has no conversation to go back to
 *  and no second window to open. Everything either draws is read live — the
 *  works collection, the member's worktree, the comments store — so a file
 *  that changes, a question that arrives, and an answer given in either place
 *  are seen by both. */

import { formatBytes } from "@kolu/byte-units";
import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import type { TerminalId } from "kolu-common/surface";
import type { Work } from "kolu-work";
import {
  type Component,
  createMemo,
  createResource,
  For,
  Show,
} from "solid-js";
import { CommentComposer } from "../../comments/CommentComposer";
import { formatMarkdown } from "../../comments/formatMarkdown";
import { useComments } from "../../comments/useComments";
import BrowseFileDispatcher from "../../right-panel/BrowseFileDispatcher";
import { useColorScheme } from "../../settings/useColorScheme";
import { conductorWide } from "../conductorLayout";
import { useWorks } from "../useWorks";
import WorkQuestion from "../WorkQuestion";
import {
  listWorkFiles,
  readKeptFile,
  readWorkFile,
  type WorkPlace,
  workPlaceOf,
} from "../workFile";
import {
  closeReader,
  openReader,
  popOutReader,
  readerFilled,
  readerHash,
  type ReaderTarget,
  toggleReaderFill,
} from "./useReader";

/** The file's own name, as every face of the reader says it: the
 *  `.waterfall/` a waterfall writes into is the directory kolu looks in, not
 *  a thing a person reads. */
export function readerFileName(path: string): string {
  return path.replace(/^\.waterfall\//, "");
}

const CONTROL =
  "shrink-0 cursor-pointer rounded-md border border-edge-bright bg-surface-0 px-2 py-0.5 text-[0.7rem] text-fg-2 hover:text-fg";

const WorkReader: Component<{
  target: ReaderTarget;
  /** WHERE THIS COPY IS DRAWN. `pane` has a conversation behind it to go back
   *  to and a second window to open; `window` is that second window. */
  placement: "pane" | "window";
  /** The frame's own placement classes — the grid cell's edge in the pane,
   *  the window's `flex-1` in a pop-out. The reader has no position of its
   *  own, for the reason the pane has none. */
  class?: string;
}> = (props) => {
  const { themeTypeLiteral: theme } = useColorScheme();
  const works = useWorks();

  /** THE WORK, from the one mirror every surface reads. A work that is not in
   *  it is one this browser has not been told about — which a popped-out
   *  window says in a line rather than drawing an empty document. */
  const work = createMemo((): Work | undefined =>
    works().find((one) => one.id === props.target.work),
  );

  /** WHERE THE BYTES COME FROM — the member's worktree while the work runs,
   *  kolu's own copy once it has ended. The same derivation the card's list
   *  uses, so the two cannot disagree about which copy of a plan is open. */
  const place = createMemo((): WorkPlace | null => {
    const one = work();
    return one === undefined ? null : workPlaceOf(one);
  });

  /** The terminal a comment is anchored against, and whose host serves the
   *  bytes. A kept file has none: kolu holds the bytes, not the tree they
   *  were written in. */
  const at = createMemo((): { host: string; terminalId: TerminalId } | null => {
    const spot = place();
    return spot === null
      ? null
      : { host: spot.host, terminalId: spot.terminalId };
  });

  const [listed] = createResource(place, listWorkFiles);

  /** THE WORK'S OTHER FILES, which are the header's tabs. In flight: whatever
   *  is in the worktree now. Ended: what kolu kept, with its size.
   *
   *  A failed read is read as the EMPTY list, never by touching `listed()`: a
   *  Solid resource RE-THROWS its failure at whoever reads it, and this memo
   *  is read inside the render. */
  const files = createMemo(
    (): ReadonlyArray<{ path: string; note: string }> => {
      const one = work();
      if (one === undefined) return [];
      return place() === null
        ? one.keptFiles.map((kept) => ({
            path: kept.path,
            note: formatBytes(kept.bytes),
          }))
        : (listed.error === undefined ? (listed() ?? []) : []).map((path) => ({
            path,
            note: "",
          }));
    },
  );

  /** THE OPEN FILE'S BYTES, keyed on the path AND the place — so a tab press
   *  reads the new file, and a work that ends while the reader is open falls
   *  back to the kept copy without the reader doing anything. */
  const [bytes] = createResource(
    (): { path: string; place: WorkPlace | null; work: string } | null =>
      work() === undefined
        ? null
        : { path: props.target.path, place: place(), work: props.target.work },
    (target): Promise<FileWithSource | FileWithUrl> =>
      target.place === null
        ? readKeptFile(target.work, target.path)
        : readWorkFile(target.place, target.path),
  );

  /** THE COMMENTS THAT WILL GO WITH AN ANSWER — the existing
   *  comments-on-files for this file, which are kept per terminal. A kept
   *  file has none: there is nothing to anchor a comment to once the worktree
   *  is gone. */
  const comments = createMemo(() => {
    const spot = place();
    return spot === null
      ? []
      : useComments(spot.terminalId).commentsForPath(props.target.path);
  });

  /** THE OPEN QUESTION ABOUT THIS WORK — the ask the record says is still
   *  unanswered. The same ask the card and the chat draw: answering it here
   *  is answering it. */
  const ask = createMemo(
    (): string | undefined =>
      work()?.decisions.find((decision) => decision.answer === null)?.ask,
  );

  return (
    <section
      data-testid="conductor-reader"
      data-work={props.target.work}
      data-path={props.target.path}
      data-placement={props.placement}
      data-filled={
        props.placement === "pane" && readerFilled() ? "" : undefined
      }
      class={`flex min-h-0 min-w-0 flex-col bg-surface-0 ${props.class ?? ""}`}
    >
      <header
        data-testid="reader-head"
        class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-4 py-2"
      >
        <Show when={props.placement === "pane"}>
          <button
            type="button"
            data-testid="reader-back"
            class="shrink-0 cursor-pointer text-[0.78rem] font-semibold text-accent hover:underline"
            onClick={() => closeReader()}
          >
            ← Work
          </button>
        </Show>
        <span class="min-w-0 truncate text-[0.82rem] font-semibold text-fg">
          {readerFileName(props.target.path)}
        </span>
        <Show when={work()}>
          {(one) => (
            <span
              data-testid="reader-of"
              class="min-w-0 flex-1 truncate text-[0.72rem] text-fg-3"
            >
              {one().title}
            </span>
          )}
        </Show>
        {/* THE WORK'S OTHER FILES, as tabs: the notes beside a plan are read
            in the same place as the plan, one press away. */}
        <div data-testid="reader-files" class="flex min-w-0 flex-wrap gap-1">
          <For each={files()}>
            {(file) => (
              <button
                type="button"
                data-testid="reader-file"
                data-path={file.path}
                data-open={file.path === props.target.path ? "" : undefined}
                data-kept={place() === null ? "" : undefined}
                class={`max-w-full cursor-pointer truncate rounded-md border px-2 py-0.5 font-mono text-[0.62rem] ${
                  file.path === props.target.path
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-edge-bright bg-surface-0 text-fg-2 hover:text-fg"
                }`}
                onClick={() => {
                  // A tab press MOVES this reader rather than opening a second
                  // one — which in a pop-out means its own route, so the
                  // window's address is always the file it is showing.
                  const next = { work: props.target.work, path: file.path };
                  if (props.placement === "window")
                    location.hash = readerHash(next);
                  else openReader(next);
                }}
              >
                {readerFileName(file.path)}
                <Show when={file.note !== ""}>
                  <span class="text-fg-3"> · {file.note}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        {/* THE TWO WAYS TO GIVE IT MORE ROOM. Neither is offered in a window
            that is already nothing but the reader, and neither on a narrow
            window, where the reader already has the screen. */}
        <Show when={props.placement === "pane" && conductorWide()}>
          <button
            type="button"
            data-testid="reader-fill"
            aria-pressed={readerFilled()}
            class={CONTROL}
            onClick={() => toggleReaderFill()}
          >
            {readerFilled() ? "Show the chat" : "Fill the screen"}
          </button>
        </Show>
        <Show when={props.placement === "pane" && conductorWide()}>
          <button
            type="button"
            data-testid="reader-popout"
            class={CONTROL}
            onClick={() => popOutReader(props.target)}
          >
            Pop out ↗
          </button>
        </Show>
      </header>

      {/* THE QUESTION, PINNED ABOVE THE DOCUMENT — its buttons, and the count
          of comments that will go with the answer. The same ask as on the
          card and in the chat: this is where it is answered by whoever is
          reading the thing it is about. */}
      <Show when={work()}>
        {(one) => (
          <Show when={ask()}>
            {(id) => (
              <div
                data-testid="reader-question"
                class="shrink-0 border-b border-alert/40 bg-alert/10 px-4 py-2"
              >
                <WorkQuestion
                  work={one()}
                  ask={id()}
                  from={props.placement === "window" ? "popout" : "reader"}
                  attach={{
                    count: comments().length,
                    text: () => formatMarkdown(comments()),
                  }}
                />
              </div>
            )}
          </Show>
        )}
      </Show>

      <Show
        when={work() !== undefined}
        fallback={
          <p
            data-testid="reader-unknown"
            class="m-0 px-4 py-3 font-mono text-[0.7rem] text-fg-3"
          >
            kolu has no record of this piece of work.
          </p>
        }
      >
        {/* `reader-doc` is the reading frame's one hook: the column's measure,
            the 16px body, and the full-width tables and code blocks are stated
            once, in `index.css`, over the viewer's own DOM. */}
        <div
          data-testid="reader-doc"
          class="reader-doc flex min-h-0 flex-1 flex-col"
        >
          <BrowseFileDispatcher
            at={at()}
            filePath={props.target.path}
            // A resource RE-THROWS its failure at its reader, and `error`
            // beside it is how the viewer is told — so the value is only read
            // when there is one.
            file={bytes.error === undefined ? (bytes() ?? null) : null}
            error={bytes.error}
            // The work's OWN files are the vault a `[[wikilink]]` in a plan
            // resolves against — the list a plan's links actually point into.
            repoVault={{
              paths: files().map((file) => file.path),
              pending: listed.loading,
            }}
            theme={theme()}
          />
        </div>
        {/* SELECTING TEXT TAKES A COMMENT, as on the Code tab — the pill is
            the surface's own, and this is the popover it opens. One per
            reader, portalled, exactly as the Code tab mounts one per tab: a
            surface that could capture a selection with nowhere to write it
            would offer to comment and then swallow the comment. A kept file
            has no terminal to anchor one against, so it has no composer
            either. */}
        <Show when={place()}>
          {(spot) => <CommentComposer terminalId={spot().terminalId} />}
        </Show>
      </Show>
    </section>
  );
};

export default WorkReader;
