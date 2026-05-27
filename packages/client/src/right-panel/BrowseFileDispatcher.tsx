/** Owns the `fsReadFile` subscription for the Code tab's browse mode and
 *  routes by the wire-level `kind` discriminator:
 *    - `text`   → `BrowseFileView`   (Pierre's syntax-highlighted CodeView)
 *    - `binary` → `BrowsePreviewView` (iframe at server-built URL)
 *
 *  Loading and error surfaces stay here so the two presenters underneath
 *  remain pure — each handles its own variant of a successful read and
 *  nothing else. The server picks the variant by file extension via
 *  `isIframePreviewable` (see `packages/server/src/iframePreviewRoute.ts`). */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Match, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { app } from "../wire";
import BrowseFileView from "./BrowseFileView";
import BrowsePreviewView from "./BrowsePreviewView";

export type BrowseFileDispatcherProps = {
  terminalId: TerminalId;
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
};

const BrowseFileDispatcher: Component<BrowseFileDispatcherProps> = (props) => {
  const fileContent = app.streams.fsReadFile.use(
    () => ({
      terminalId: props.terminalId,
      repoPath: props.repoPath,
      filePath: props.filePath,
    }),
    {
      onError: (err) => toast.error(`File content stream: ${err.message}`),
    },
  );

  // Pre-narrow to each variant so the Match arms receive a typed accessor
  // without needing a runtime re-check inside the callback.
  const textContent = createMemo(() => {
    const fc = fileContent();
    return fc?.kind === "text" ? fc : null;
  });
  const binaryContent = createMemo(() => {
    const fc = fileContent();
    return fc?.kind === "binary" ? fc : null;
  });

  return (
    <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
      <Match when={fileContent.error()}>
        {(err) => (
          <div class="px-2 py-1 text-danger">Error: {err().message}</div>
        )}
      </Match>
      <Match when={textContent()}>
        {(fc) => (
          <BrowseFileView
            terminalId={props.terminalId}
            filePath={props.filePath}
            content={fc().content}
            truncated={fc().truncated}
            theme={props.theme}
            initialSelectedLines={props.initialSelectedLines}
          />
        )}
      </Match>
      <Match when={binaryContent()}>
        {(fc) => (
          <BrowsePreviewView
            terminalId={props.terminalId}
            filePath={props.filePath}
            url={fc().url}
          />
        )}
      </Match>
    </Switch>
  );
};

export default BrowseFileDispatcher;
