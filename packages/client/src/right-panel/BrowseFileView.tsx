/** File content viewer for the Code tab's browse mode. Reads the file via
 *  RPC and hands the contents to Pierre's `File` renderer for shiki-powered
 *  syntax highlighting. Kept as its own module so `CodeTab.tsx` stays a
 *  layout shell. */

import { type Component, createResource, Match, Show, Switch } from "solid-js";
import { client } from "../rpc/rpc";
import PierreFileView from "../ui/PierreFileView";

export type BrowseFileViewProps = {
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
};

const BrowseFileView: Component<BrowseFileViewProps> = (props) => {
  const [fileContent] = createResource(
    () => ({ repoPath: props.repoPath, filePath: props.filePath }),
    (input) => client.fs.readFile(input),
  );

  return (
    <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
      <Match when={fileContent.error}>
        <div class="px-2 py-1 text-danger">
          Error: {(fileContent.error as Error).message}
        </div>
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
