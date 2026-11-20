import { formatBytes } from "@kolu/byte-units";
import { Option } from "effect";
import {
  WATERFALL_DIR,
  waterfallBytes,
  waterfallFileName,
  waterfallLevel,
} from "kolu-work";
import { WORK_FILES_LISTED } from "kolu-common/workFiles";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import type { WorkFileRow } from "./workFile";

interface WorkFileListProps {
  readonly rows: ReadonlyArray<WorkFileRow>;
  readonly more: boolean;
  readonly openTo: string | undefined;
  readonly layout: "wrap" | "line";
  readonly onOpen: (path: string) => void;
}

const CHIP =
  "max-w-full shrink-0 cursor-pointer truncate rounded-md border px-2 py-0.5 font-mono text-[0.62rem]";

const WorkFileList: Component<WorkFileListProps> = (props) => {
  const [pressed, setPressed] = createSignal<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const unfolded = (folder: string): boolean =>
    pressed().get(folder) ?? props.openTo?.startsWith(folder) ?? false;
  const toggle = (folder: string): void => {
    const now = !unfolded(folder);
    setPressed((was) => new Map(was).set(folder, now));
  };

  const Level: Component<{
    folder: string;
    rows: ReadonlyArray<WorkFileRow>;
  }> = (level) => {
    const read = createMemo(() => waterfallLevel(level.rows, level.folder));
    return (
      <>
        <For each={read().files}>
          {(file) => (
            <button
              type="button"
              data-testid="work-file"
              data-path={file.path}
              data-open={props.openTo === file.path ? "" : undefined}
              data-kept={Option.isSome(file.bytes) ? "" : undefined}
              title={waterfallFileName(file.path)}
              onClick={() => props.onOpen(file.path)}
              class={`${CHIP} ${
                props.openTo === file.path
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-edge-bright bg-surface-0 text-fg-2 hover:text-fg"
              }`}
            >
              {file.path.slice(level.folder.length)}
              <Show when={Option.getOrUndefined(file.bytes)}>
                {(bytes) => (
                  <span class="text-fg-3"> · {formatBytes(bytes())}</span>
                )}
              </Show>
            </button>
          )}
        </For>
        <For each={read().folders}>
          {(one) => (
            <>
              <button
                type="button"
                data-testid="work-folder"
                data-path={one.folder}
                data-count={one.files.length}
                aria-expanded={unfolded(one.folder)}
                onClick={() => toggle(one.folder)}
                class={`${CHIP} border-dashed ${
                  unfolded(one.folder)
                    ? "border-accent/60 text-fg"
                    : "border-edge-bright text-fg-2 hover:text-fg"
                }`}
              >
                {one.folder.slice(level.folder.length)}
                <span class="text-fg-3">
                  {" · "}
                  {one.files.length}
                  <Show when={Option.getOrUndefined(waterfallBytes(one.files))}>
                    {(bytes) => ` · ${formatBytes(bytes())}`}
                  </Show>
                </span>
              </button>
              <Show when={unfolded(one.folder)}>
                <div
                  data-testid="work-folder-level"
                  data-path={one.folder}
                  class={
                    props.layout === "wrap"
                      ? "flex basis-full flex-wrap gap-1.5 border-l border-edge pl-2"
                      : "flex shrink-0 gap-1 border-l border-edge pl-1"
                  }
                >
                  <Level folder={one.folder} rows={one.files} />
                </div>
              </Show>
            </>
          )}
        </For>
      </>
    );
  };

  let strip: HTMLDivElement | undefined;
  createEffect(
    on([() => props.openTo, () => props.rows], () => {
      if (props.layout !== "line" || strip === undefined) return;
      const chip = strip.querySelector<HTMLElement>(
        '[data-testid="work-file"][data-open]',
      );
      if (chip === null) return;
      const edge = strip.getBoundingClientRect();
      const box = chip.getBoundingClientRect();
      if (box.left < edge.left) strip.scrollLeft -= edge.left - box.left;
      else if (box.right > edge.right)
        strip.scrollLeft += box.right - edge.right;
    }),
  );

  return (
    <>
      <div
        ref={strip}
        data-testid={props.layout === "line" ? "work-files-strip" : undefined}
        class={
          props.layout === "wrap"
            ? "mt-1 flex flex-wrap gap-1.5"
            : "flex min-w-0 gap-1 overflow-x-auto"
        }
      >
        <Level folder={WATERFALL_DIR} rows={props.rows} />
      </div>
      <Show when={props.more}>
        <p
          data-testid="work-files-more"
          class="m-0 mt-1 font-mono text-[0.62rem] text-fg-3"
        >
          Only the first {WORK_FILES_LISTED} are listed.
        </p>
      </Show>
    </>
  );
};

export default WorkFileList;
