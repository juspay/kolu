import type { WorkId } from "kolu-work";
import { type Component, Show } from "solid-js";
import { openReader, readerTarget } from "./reader/useReader";
import { createWorkFiles, type WorkFileSource } from "./workFile";
import WorkFileList from "./WorkFileList";

const WorkFiles: Component<{
  id: WorkId;
  source: WorkFileSource;
  kept: boolean;
  notKept: string | undefined;
}> = (props) => {
  const files = createWorkFiles(() => props.source);

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
      <Show
        when={files.rows().length > 0}
        fallback={
          <Show when={props.notKept === undefined}>
            <p class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3">
              {files.error() === undefined
                ? props.kept
                  ? "Nothing was written."
                  : "Nothing written yet."
                : `Could not read the worktree — ${files.error()?.message}`}
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
