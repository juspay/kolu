/**
 * Full-width diff modal — shows unified diff for a single file with
 * syntax-colored add/remove lines, line numbers, and hunk headers.
 * Opened from the Changes sidebar tab or when selecting a modified file
 * in file search.
 */

import {
  type Component,
  createSignal,
  createEffect,
  on,
  For,
  Show,
} from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { client } from "./rpc";
import { match } from "ts-pattern";
import type { FsFileDiffOutput, DiffHunk } from "kolu-common";

const DiffModal: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: string | null;
  filePath: string | null;
}> = (props) => {
  const [diff, setDiff] = createSignal<FsFileDiffOutput | null>(null);
  const [loading, setLoading] = createSignal(false);

  createEffect(
    on(
      () => [props.root, props.filePath, props.open] as const,
      ([root, filePath, open]) => {
        setDiff(null);
        if (!root || !filePath || !open) return;
        setLoading(true);
        void client.fs
          .fileDiff({ root, filePath })
          .then(setDiff)
          .catch((err: unknown) => {
            console.warn("Failed to load diff:", err);
          })
          .finally(() => setLoading(false));
      },
    ),
  );

  const totalAdded = () =>
    diff()?.hunks.reduce(
      (n, h) => n + h.lines.filter((l) => l.kind === "add").length,
      0,
    ) ?? 0;
  const totalRemoved = () =>
    diff()?.hunks.reduce(
      (n, h) => n + h.lines.filter((l) => l.kind === "remove").length,
      0,
    ) ?? 0;

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        data-testid="diff-modal"
        class="w-4xl max-w-[95vw] bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
        style={{
          height: "min(40rem, 85vh)",
          "background-color": "var(--color-surface-1)",
        }}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-edge">
          <div class="flex items-center gap-2 min-w-0">
            <svg
              class="w-4 h-4 text-fg-3 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M4 2v12M12 2v12M4 6h8M4 10h8" />
            </svg>
            <span class="text-sm text-fg truncate font-mono">
              {props.filePath}
            </span>
            <Show when={diff()}>
              <span class="shrink-0 text-xs text-green-400 font-mono">
                +{totalAdded()}
              </span>
              <span class="shrink-0 text-xs text-red-400 font-mono">
                -{totalRemoved()}
              </span>
            </Show>
          </div>
          <button
            class="text-fg-3 hover:text-fg transition-colors shrink-0"
            onClick={() => props.onOpenChange(false)}
            title="Close"
          >
            <svg
              class="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        {/* Diff content */}
        <div class="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5">
          <Show
            when={!loading()}
            fallback={<div class="p-4 text-fg-3">Loading diff...</div>}
          >
            <Show
              when={diff()?.hunks.length}
              fallback={
                <div class="p-4 text-fg-3 italic">No changes to display</div>
              }
            >
              <table class="w-full border-collapse">
                <tbody>
                  <For each={diff()!.hunks}>
                    {(hunk, hunkIdx) => (
                      <>
                        {/* Hunk separator */}
                        <Show when={hunkIdx() > 0}>
                          <tr>
                            <td
                              colspan="4"
                              class="h-2 bg-surface-0 border-y border-edge/30"
                            />
                          </tr>
                        </Show>
                        {/* Hunk header */}
                        <tr class="bg-blue-500/5">
                          <td
                            colspan="4"
                            class="px-4 py-1 text-fg-3 text-[0.7rem] select-none"
                          >
                            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart}
                            ,{hunk.newCount} @@
                          </td>
                        </tr>
                        {/* Diff lines */}
                        <For each={hunk.lines}>
                          {(line) => {
                            const style = match(line.kind)
                              .with("add", () => ({
                                bg: "bg-green-500/10",
                                marker: "+",
                                markerColor: "text-green-400",
                                textColor: "text-green-200",
                              }))
                              .with("remove", () => ({
                                bg: "bg-red-500/10",
                                marker: "-",
                                markerColor: "text-red-400",
                                textColor: "text-red-200",
                              }))
                              .with("context", () => ({
                                bg: "",
                                marker: " ",
                                markerColor: "text-fg-3",
                                textColor: "text-fg-2",
                              }))
                              .exhaustive();
                            return (
                              <tr class={`${style.bg} hover:brightness-110`}>
                                {/* Old line number */}
                                <td class="w-12 text-right pr-1 pl-3 text-fg-3/50 select-none">
                                  {line.oldLine ?? ""}
                                </td>
                                {/* New line number */}
                                <td class="w-12 text-right pr-2 text-fg-3/50 select-none border-r border-edge/20">
                                  {line.newLine ?? ""}
                                </td>
                                {/* +/- marker */}
                                <td
                                  class={`w-6 text-center select-none ${style.markerColor}`}
                                >
                                  {style.marker}
                                </td>
                                {/* Content */}
                                <td
                                  class={`pr-4 whitespace-pre ${style.textColor}`}
                                >
                                  {line.content || " "}
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
        </div>
        {/* Footer hint */}
        <div class="px-4 py-2 text-[0.7rem] text-fg-3 border-t border-edge">
          <kbd class="text-fg-3">esc</kbd> close
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default DiffModal;
