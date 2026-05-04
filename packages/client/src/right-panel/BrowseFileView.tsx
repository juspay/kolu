/** File content viewer for the Code tab's browse mode. Subscribes to the
 *  server's live file-content stream so editor saves and branch checkouts
 *  reflect without a manual refresh. The wrapper around `@kolu/solid-pierre`'s
 *  `FileView` provides shiki-powered syntax highlighting; equality-gating
 *  the snapshot via `reconcile` (inside `useStream`'s underlying primitive)
 *  avoids stomping scroll position on no-op ticks. */

import { FileView } from "@kolu/solid-pierre";
import { type Component, Match, Show, Switch } from "solid-js";
import { toast } from "solid-sonner";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "../ui/CodeContextMenu";
import { pierreDiffsStyle } from "../ui/pierreTheme";
import { useLineSelection } from "../ui/useLineSelection";
import { app } from "../wire";

export type BrowseFileViewProps = {
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  const fileContent = app.streams.fsReadFile.use(
    () => ({ repoPath: props.repoPath, filePath: props.filePath }),
    {
      onError: (err) => toast.error(`File content stream: ${err.message}`),
    },
  );

  let menuCtrl: CodeContextMenuController | undefined;
  const selection = useLineSelection(() => props.filePath);

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
            <div
              // Attach contextmenu via addEventListener so the host div
              // doesn't carry interactive JSX props — the inner Pierre
              // canvas is the actual interactive surface; the host is
              // layout only.
              ref={(el) =>
                el.addEventListener("contextmenu", (e) => menuCtrl?.open(e))
              }
              class="h-full w-full"
            >
              <FileView
                name={props.filePath}
                contents={fc().content}
                theme={props.theme}
                enableLineSelection
                onLineSelected={selection.handleSelect}
                onError={(err) =>
                  toast.error(`File render failed: ${err.message}`)
                }
                class="h-full w-full overflow-auto"
                style={pierreDiffsStyle}
              />
              <CodeContextMenu
                getItems={selection.buildItems}
                ref={(c) => (menuCtrl = c)}
              />
            </div>
          </>
        )}
      </Match>
    </Switch>
  );
};

export default BrowseFileView;
