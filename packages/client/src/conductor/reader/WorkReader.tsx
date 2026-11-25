/** THE READER — a work's file, given the large side of the screen.
 *
 *  A plan is the one thing a person has to read before they approve it, and
 *  the worst place to read it is a box in the corner of a card. So a file row
 *  opens HERE: about two thirds of the Conductor's screen, with the
 *  conversation beside it (`ConductorPane.tsx` owns that frame), the questions
 *  about the work pinned above the document, and the chrome its owner gives
 *  it ("← Work", fill, pop out) in the header.
 *
 *  ONE VIEWER, NOT A SECOND ONE. The document is drawn by
 *  `BrowseFileDispatcher` — kolu's markdown, its images, its HTML sandbox and
 *  its comments-on-files, the same renderers the Code tab uses — so the
 *  Rendered ⇄ Source toggle at the document's head is that component's, not a
 *  second control here that would start identical and drift by a release.
 *  What this adds around it is the reading FRAME: the work's other files as
 *  tabs (the card's own chip list, `WorkFileList.tsx`, on one line that
 *  scrolls sideways and starts at the folder being read), the questions, and
 *  whatever chrome the owner hands in.
 *
 *  THE DOCUMENT IS SET FOR READING — a column of
 *  `--container-conductor-reader` at 16px with a generous line height, with
 *  tables and code blocks free to use the pane's full width and scroll
 *  sideways rather than squeeze (the `.reader-doc` rules in `index.css`). The
 *  squeeze is not a style question: a table's columns can never be narrower
 *  than their longest word, so a table in a 430px card is a table with one
 *  word a line.
 *
 *  IT OWNS NEITHER THE ADDRESS NOR THE CHROME. Where "which file is being
 *  read" lives is the OWNER'S question — the pane keeps it in a module signal,
 *  the pop-out keeps it in that window's hash — so the owner hands in `onOpen`
 *  and the reader just asks to be moved. Likewise `from`: the face a decision
 *  records is a fact about who mounted this, not something to re-derive from a
 *  placement word at the answer site. Everything either owner draws is read
 *  live, so a file that changes, a question that arrives, and an answer given
 *  in either place are seen by both. */

import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import { type AnsweredFromFace, openAsks, type Work } from "kolu-work";
import {
  type Component,
  createMemo,
  createResource,
  For,
  type JSX,
  Show,
} from "solid-js";
import { CommentComposer } from "../../comments/CommentComposer";
import { CommentView, createCommentView } from "../../comments/commentView";
import { formatMarkdown } from "../../comments/formatMarkdown";
import { commentsFor } from "../../comments/useComments";
import BrowseFileDispatcher from "../../code-view/BrowseFileDispatcher";
import { rightPanelCodeDoor } from "../../right-panel/openInCodeTab";
import { useColorScheme } from "../../settings/useColorScheme";
import { useWorkMap, useWorkMembers } from "../useWorks";
import WorkChip from "../WorkChip";
import WorkChipFace from "../WorkChipFace";
import WorkQuestion from "../WorkQuestion";
import {
  createWorkFiles,
  workFileName,
  type WorkFileSource,
  workFileSource,
} from "../workFile";
import { readWorkFacts } from "../workFacts";
import WorkFileList from "../WorkFileList";
import { membersIn } from "../workReadings";
import type { ReaderTarget } from "./useReader";

const WorkReader: Component<{
  target: ReaderTarget;
  /** WHICH FACE THIS IS, as the record will remember an answer given here.
   *  The owner says so; the reader never infers it. */
  from: Extract<AnsweredFromFace, "reader" | "popout">;
  /** MOVE THE READER to another of the work's files. Who owns that fact is
   *  the owner's business: the pane writes its module signal, the pop-out
   *  writes its own window's address. */
  onOpen: (next: ReaderTarget) => void;
  /** The owner's own controls in the header — "← Work", fill, pop out. A
   *  window that is nothing but the reader has none. */
  chrome?: JSX.Element;
  /** Whether this window has a work listing to bring the work into. The
   *  pane does; a reader popped out on its own does not, so its work chip
   *  names the work without being a button. */
  listing: boolean;
  /** The frame's own placement classes — the grid cell's edge in the pane,
   *  the window's `flex-1` in a pop-out. The reader has no position of its
   *  own, for the reason the pane has none. */
  class?: string;
}> = (props) => {
  const { themeTypeLiteral: theme } = useColorScheme();
  const works = useWorkMap();
  const allMembers = useWorkMembers();
  /** The work's members, each with its standing read once — what the one
   *  "which member stands in the worktree" rule reads. */
  const { members } = readWorkFacts(() =>
    membersIn(allMembers(), props.target.work),
  );

  /** THE WORK, from the one mirror every surface reads, by the id it is filed
   *  under. A work that is not in it is one this browser has not been told
   *  about — which a popped-out window says in a line rather than drawing an
   *  empty document. */
  const work = createMemo((): Work | undefined =>
    works().get(props.target.work),
  );

  /** WHERE THE BYTES COME FROM — the member's worktree while the work runs,
   *  kolu's own copy once it has ended. The SAME derivation the card's list
   *  uses, chosen once in `workFile.ts`, so the two cannot disagree about
   *  which copy of a plan is open. */
  const source = createMemo(() => {
    const one = work();
    if (one === undefined) return null;
    return workFileSource(props.target.work, one, members());
  });

  /** Where the bytes are served from: the work's worktree on its host, and
   *  the terminal a picture is fetched through, if any. A kept file has
   *  none: kolu holds the bytes, not the tree they were written in. */
  const at = createMemo(() => source()?.at ?? null);

  /** Where a link in the document opens: the Right panel's Code tab, through
   *  its front door, for the terminal the bytes belong to — and nowhere for a
   *  kept file. */
  const door = rightPanelCodeDoor(() => at()?.terminalId ?? null);

  /** The work's other files, which are the header's tabs — the one list
   *  derivation, shared with the card. */
  const files = createWorkFiles(source);

  /** THE OPEN FILE'S BYTES, keyed on the path AND the source — so a tab press
   *  reads the new file, and a work that ends while the reader is open falls
   *  back to the kept copy without the reader doing anything. */
  const [bytes] = createResource(
    (): { path: string; source: WorkFileSource } | null => {
      const from = source();
      return from === null ? null : { path: props.target.path, source: from };
    },
    (target): Promise<FileWithSource | FileWithUrl> =>
      target.source.read(target.path),
  );

  /** WHOSE COMMENTS this file's are: the work's own queue for its live
   *  folder, whichever member is up — or none for a kept file, which has
   *  nothing to anchor a comment to once the worktree is gone. */
  const queue = createMemo(() => source()?.comments ?? null);
  /** THE COMMENTS THAT WILL GO WITH AN ANSWER — the ones on this file in
   *  that queue, and none without one. */
  const commentsAt = commentsFor(queue);
  const comments = createMemo(
    () => commentsAt()?.commentsForPath(props.target.path) ?? [],
  );

  /** THE OPEN QUESTIONS ABOUT THIS WORK — every ask the record still has
   *  waiting, in the order they were put. The same asks the card and the chat
   *  draw: answering one here is answering it. */
  const asks = createMemo((): ReadonlyArray<string> => {
    const one = work();
    return one === undefined ? [] : openAsks(one);
  });

  /** THIS READER'S OWN DRAFT AND SCROLL REQUEST — a draft opened here is
   *  drawn and saved here, whatever other comment-capturing view is mounted
   *  beside it (the Right panel's Code view stays mounted under the
   *  Conductor). */
  const commentView = createCommentView();

  return (
    <CommentView.Provider value={commentView}>
      <section
        data-testid="conductor-reader"
        data-work={props.target.work}
        data-path={props.target.path}
        // WHICH FACE THIS IS — the fact an answer from here is recorded under,
        // and the one a test asks about.
        data-from={props.from}
        class={`flex min-h-0 min-w-0 flex-col bg-surface-0 ${props.class ?? ""}`}
      >
        <header
          data-testid="reader-head"
          class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-4 py-2"
        >
          <span class="min-w-0 truncate text-[0.82rem] font-semibold text-fg">
            {workFileName(props.target.path)}
          </span>
          <Show when={work()}>
            {(one) => (
              // THE WAY BACK TO THE WORK: the chip that brings its card, where
              // this window has a listing to bring it into — and the same face,
              // not pressed, in a pop-out that has none.
              <span data-testid="reader-of" class="min-w-0 flex-1">
                <Show
                  when={props.listing}
                  fallback={<WorkChipFace work={one()} />}
                >
                  <WorkChip id={props.target.work} work={one()} />
                </Show>
              </span>
            )}
          </Show>
          {props.chrome}
          {/* THE WORK'S OTHER FILES, as tabs: the notes beside a plan are read
            in the same place as the plan, one press away — on a line of their
            own, under the title and the chrome. */}
          <div data-testid="reader-files" class="min-w-0 basis-full">
            <WorkFileList
              rows={files.rows()}
              more={files.more()}
              openTo={props.target.path}
              layout="line"
              onOpen={(path) => props.onOpen({ work: props.target.work, path })}
            />
          </div>
        </header>

        {/* THE QUESTIONS, PINNED ABOVE THE DOCUMENT — their buttons, and the
          count of comments that will go with the answer. The same asks as on
          the card and in the chat: this is where they are answered by whoever
          is reading the thing they are about. */}
        <Show when={work()}>
          {(one) => (
            <For each={asks()}>
              {(id) => (
                <div
                  data-testid="reader-question"
                  class="shrink-0 border-b border-alert/40 bg-alert/10 px-4 py-2"
                >
                  <WorkQuestion
                    work={one()}
                    id={props.target.work}
                    ask={id}
                    from={props.from}
                    attach={{
                      count: comments().length,
                      text: () => formatMarkdown(comments()),
                    }}
                  />
                </div>
              )}
            </For>
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
              comments={queue()}
              open={at() === null ? null : door.open}
              filePath={props.target.path}
              // A resource RE-THROWS its failure at its reader, and `error`
              // beside it is how the viewer is told — so the value is only read
              // when there is one.
              file={bytes.error === undefined ? (bytes() ?? null) : null}
              error={bytes.error}
              // The work's OWN files are the vault a `[[wikilink]]` in a plan
              // resolves against — the list a plan's links actually point into.
              repoVault={{
                paths: files.rows().map((file) => file.path),
                pending: files.pending(),
              }}
              theme={theme()}
            />
          </div>
          {/* SELECTING TEXT TAKES A COMMENT, as on the Code tab — the pill is
            the surface's own, and this is the popover it opens. One per
            reader, portalled, exactly as the Code tab mounts one per tab: a
            surface that could capture a selection with nowhere to write it
            would offer to comment and then swallow the comment. A kept file
            has no queue to file one in, so it has no composer either. */}
          <Show when={queue()}>
            {(one) => <CommentComposer queue={one()} />}
          </Show>
        </Show>
      </section>
    </CommentView.Provider>
  );
};

export default WorkReader;
