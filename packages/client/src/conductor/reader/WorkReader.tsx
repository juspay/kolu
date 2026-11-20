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
import { formatMarkdown } from "../../comments/formatMarkdown";
import { commentsForTerminal } from "../../comments/useComments";
import BrowseFileDispatcher from "../../right-panel/BrowseFileDispatcher";
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
import WorkFileList from "../WorkFileList";
import { membersIn } from "../workReadings";
import type { ReaderTarget } from "./useReader";

const WorkReader: Component<{
  target: ReaderTarget;
  from: Extract<AnsweredFromFace, "reader" | "popout">;
  onOpen: (next: ReaderTarget) => void;
  chrome?: JSX.Element;
  listing: boolean;
  class?: string;
}> = (props) => {
  const { themeTypeLiteral: theme } = useColorScheme();
  const works = useWorkMap();
  const allMembers = useWorkMembers();

  const work = createMemo((): Work | undefined =>
    works().get(props.target.work),
  );

  const source = createMemo(() => {
    const one = work();
    if (one === undefined) return null;
    return workFileSource(
      props.target.work,
      one,
      membersIn(allMembers(), props.target.work),
    );
  });

  const at = createMemo(() => source()?.at ?? null);

  const files = createWorkFiles(source);

  const [bytes] = createResource(
    (): { path: string; source: WorkFileSource } | null => {
      const from = source();
      return from === null ? null : { path: props.target.path, source: from };
    },
    (target): Promise<FileWithSource | FileWithUrl> =>
      target.source.read(target.path),
  );

  const commentsAt = commentsForTerminal(() => at()?.terminalId ?? "");
  const comments = createMemo(() =>
    at() === null ? [] : commentsAt().commentsForPath(props.target.path),
  );

  const asks = createMemo((): ReadonlyArray<string> => {
    const one = work();
    return one === undefined ? [] : openAsks(one);
  });

  return (
    <section
      data-testid="conductor-reader"
      data-work={props.target.work}
      data-path={props.target.path}
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
            filePath={props.target.path}
            file={bytes.error === undefined ? (bytes() ?? null) : null}
            error={bytes.error}
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
            has no terminal to anchor one against, so it has no composer
            either. */}
        <Show when={at()}>
          {(spot) => <CommentComposer terminalId={spot().terminalId} />}
        </Show>
      </Show>
    </section>
  );
};

export default WorkReader;
