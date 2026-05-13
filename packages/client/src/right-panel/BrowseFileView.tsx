/** File content viewer for the Code tab's browse mode. Subscribes to the
 *  server's live file-content stream so editor saves and branch checkouts
 *  reflect without a manual refresh. The wrapper around `@kolu/solid-pierre`'s
 *  `FileView` provides shiki-powered syntax highlighting; equality-gating
 *  the snapshot via `reconcile` (inside `useStream`'s underlying primitive)
 *  avoids stomping scroll position on no-op ticks.
 *
 *  Line-selection wiring lives one level up in `CodeTab` so both this
 *  browse path and the diff path wrap a single `CodeMenuFrame` at the
 *  same depth (symmetric forwarding to the comments-tray composer). The
 *  caller passes the `LineSelection` controller in via props. */

import { FileView, Virtualizer } from "@kolu/solid-pierre";
import { type Component, Match, Show, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { pierreDiffsStyle } from "../ui/pierreTheme";
import type { LineSelection } from "../ui/useLineSelection";
import { app } from "../wire";

export type BrowseFileViewProps = {
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
  /** Line-selection controller owned by the parent `CodeMenuFrame`. */
  selection: LineSelection;
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
              <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30 shrink-0">
                File truncated (exceeds 1 MB)
              </div>
            </Show>
            {/* `<Virtualizer>` upgrades `<FileView>` to Pierre's
             *  `VirtualizedFile` for very large files
             *  (#809 / #514 Phase 8). Without it, `<FileView>` uses
             *  the vanilla `File` class — same behavior as before. */}
            <Virtualizer
              class="flex-1 min-h-0 overflow-auto"
              style={pierreDiffsStyle}
            >
              <FileView
                name={props.filePath}
                contents={fc().content}
                theme={props.theme}
                overflow="wrap"
                enableLineSelection
                onLineSelected={props.selection.handleSelect}
                selectedLines={props.selection.range()}
                onError={(err) =>
                  toast.error(`File render failed: ${err.message}`)
                }
                class="w-full"
              />
            </Virtualizer>
          </>
        )}
      </Match>
    </Switch>
  );
};

export default BrowseFileView;
