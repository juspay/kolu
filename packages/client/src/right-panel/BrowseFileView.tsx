/** File content viewer for the Code tab's browse mode. Subscribes to the
 *  server's live file-content stream so editor saves and branch checkouts
 *  reflect without a manual refresh. The wrapper around Pierre's `File`
 *  renderer provides shiki-powered syntax highlighting; equality-gating
 *  the snapshot via `reconcile` (inside `useStream`'s underlying primitive)
 *  avoids stomping scroll position on no-op ticks. */

import { useStream } from "@kolu/cells/solid";
import { fsReadFileStream } from "kolu-common/cells";
import { type Component, Match, Show, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "../cells";
import PierreFileView from "../ui/PierreFileView";

export type BrowseFileViewProps = {
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  const fileContent = useStream(
    fsReadFileStream,
    () => ({ repoPath: props.repoPath, filePath: props.filePath }),
    client.fs.onReadFileChange,
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
            <PierreFileView
              name={props.filePath}
              contents={fc().content}
              theme={props.theme}
            />
          </>
        )}
      </Match>
    </Switch>
  );
};

export default BrowseFileView;
