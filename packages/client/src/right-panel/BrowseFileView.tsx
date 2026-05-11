/** File content viewer for the Code tab's browse mode. Subscribes to the
 *  server's live file-content stream so editor saves and branch checkouts
 *  reflect without a manual refresh. The wrapper around `@kolu/solid-pierre`'s
 *  `FileView` provides shiki-powered syntax highlighting; equality-gating
 *  the snapshot via `reconcile` (inside `useStream`'s underlying primitive)
 *  avoids stomping scroll position on no-op ticks. */

import {
  FileView,
  type SelectedLineRangeWithKey,
  Virtualizer,
} from "@kolu/solid-pierre";
import { type Component, Match, Show, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { pierreDiffsStyle } from "../ui/pierreTheme";
import { app } from "../wire";
import CodeMenuFrame from "./CodeMenuFrame";

export type BrowseFileViewProps = {
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
  /** Initial line range to highlight (and scroll to). Set when the
   *  user opened this file via a terminal file-ref click; the `key`
   *  ensures re-clicks on the same `path:line` re-apply the highlight
   *  even when start/end happen to be identical to the prior call. */
  selectedRange?: SelectedLineRangeWithKey | null;
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  const fileContent = app.streams.fsReadFile.use(
    () => ({ repoPath: props.repoPath, filePath: props.filePath }),
    {
      onError: (err) => toast.error(`File content stream: ${err.message}`),
    },
  );

  return (
    <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
      <Match when={fileContent.error()}>
        {(err) => (
          <div class="px-2 py-1 text-danger">Error: {err().message}</div>
        )}
      </Match>
      <Match when={fileContent()}>
        {(fc) => (
          <>
            <Show when={fc().truncated}>
              <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
                File truncated (exceeds 1 MB)
              </div>
            </Show>
            <CodeMenuFrame path={props.filePath}>
              {(selection) => (
                // `<Virtualizer>` upgrades `<FileView>` to Pierre's
                // `VirtualizedFile` for very large files
                // (#809 / #514 Phase 8). Without it, `<FileView>` uses
                // the vanilla `File` class — same behavior as before.
                <Virtualizer
                  class="h-full w-full overflow-auto"
                  style={pierreDiffsStyle}
                >
                  <FileView
                    name={props.filePath}
                    contents={fc().content}
                    theme={props.theme}
                    overflow="wrap"
                    enableLineSelection
                    onLineSelected={selection.handleSelect}
                    selectedRange={props.selectedRange ?? null}
                    onError={(err) =>
                      toast.error(`File render failed: ${err.message}`)
                    }
                    class="w-full"
                  />
                </Virtualizer>
              )}
            </CodeMenuFrame>
          </>
        )}
      </Match>
    </Switch>
  );
};

export default BrowseFileView;
