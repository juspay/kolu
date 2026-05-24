/** MobileCodeSheet — content of the mobile file-browser drawer.
 *
 *  On mobile the right panel is hidden (`RightPanelLayout` returns its
 *  children directly when `isMobile()` is true), so the Code tab's file
 *  tree + content split has nowhere to live. This sheet is the mobile
 *  surface for the same data — a bottom drawer with a master-detail
 *  flow:
 *
 *  - **Master**: Pierre's `FileTree` over the active terminal's repo
 *    (`fsListAll` stream).
 *  - **Detail**: `BrowseFileDispatcher` — text files render via Pierre's
 *    `CodeView`, `.html`/`.svg`/`.pdf` render via the sandboxed
 *    `iframe` preview the desktop Code tab uses. Identical components,
 *    no mobile-specific viewer.
 *
 *  Selection persists per-terminal via `useRightPanel.selectedFile`,
 *  keyed by `"browse"` mode — the same slot the desktop CodeTab writes,
 *  so opening the same terminal on desktop after a mobile session
 *  restores the last-viewed file. The back arrow clears the slot;
 *  the close button dismisses the whole drawer without touching
 *  selection. */

import { FileTree } from "@kolu/solid-pierre";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, Match, Show, Switch } from "solid-js";
import { toast } from "solid-sonner";
import BrowseFileDispatcher from "./right-panel/BrowseFileDispatcher";
import { useRightPanel } from "./right-panel/useRightPanel";
import { useColorScheme } from "./settings/useColorScheme";
import { pierreIconConfig, pierreTreesStyle } from "./ui/pierreTheme";
import { app } from "./wire";
import { FileBrowseIcon, GitBranchIcon } from "./ui/Icons";

const MobileCodeSheet: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  onClose: () => void;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();
  const repoPath = () => props.meta?.git?.repoRoot ?? null;
  const selectedPath = () => rightPanel.selectedFile("browse");

  const allPaths = app.streams.fsListAll.use(
    () => {
      const p = repoPath();
      return p ? { repoPath: p } : null;
    },
    {
      onError: (err) => toast.error(`File list stream: ${err.message}`),
    },
  );

  return (
    <div
      data-testid="mobile-code-sheet"
      class="flex flex-col h-full bg-surface-1 text-fg"
    >
      {/* Header — back arrow (detail only), title, close (×). */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0 min-h-11">
        <Show
          when={selectedPath()}
          fallback={
            <span class="flex items-center gap-2 flex-1 min-w-0 text-sm font-semibold">
              <FileBrowseIcon class="w-4 h-4 shrink-0" />
              Files
            </span>
          }
        >
          {(path) => (
            <>
              <button
                type="button"
                data-testid="mobile-code-back"
                class="h-8 w-8 flex items-center justify-center text-fg-2 rounded-md active:bg-surface-2"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => rightPanel.clearSelectedFile("browse")}
                aria-label="Back to file tree"
              >
                ‹
              </button>
              <span
                class="flex-1 min-w-0 text-sm font-mono truncate"
                title={path()}
              >
                {path()}
              </span>
            </>
          )}
        </Show>
        <button
          type="button"
          data-testid="mobile-code-close"
          class="h-8 w-8 flex items-center justify-center text-fg-2 rounded-md active:bg-surface-2 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={props.onClose}
          aria-label="Close files"
        >
          ×
        </button>
      </div>

      {/* Body — tree or detail. */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show
          when={repoPath()}
          fallback={
            <div
              class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]"
              data-testid="mobile-code-no-repo"
            >
              <GitBranchIcon class="w-8 h-8 opacity-40" />
              Not in a git repository
            </div>
          }
        >
          {(repo) => (
            <Show
              when={selectedPath()}
              fallback={
                <Switch
                  fallback={
                    <div class="px-2 py-1 text-fg-3/50 text-[11px]">
                      Loading…
                    </div>
                  }
                >
                  <Match when={allPaths.error()}>
                    {(err) => (
                      <div class="px-2 py-1 text-danger text-[11px]">
                        Error: {err().message}
                      </div>
                    )}
                  </Match>
                  <Match when={allPaths()}>
                    {(paths) => (
                      <FileTree
                        paths={paths().paths}
                        selectedPath={null}
                        onSelect={(p) => {
                          if (p !== null)
                            rightPanel.setSelectedFile("browse", p);
                        }}
                        initialExpansion="closed"
                        search={true}
                        icons={pierreIconConfig}
                        onError={(err) =>
                          toast.error(`File tree render failed: ${err.message}`)
                        }
                        class="h-full w-full"
                        style={pierreTreesStyle}
                      />
                    )}
                  </Match>
                </Switch>
              }
            >
              {(path) => {
                const tid = props.terminalId;
                if (tid === null) return null;
                return (
                  <BrowseFileDispatcher
                    terminalId={tid}
                    repoPath={repo()}
                    filePath={path()}
                    theme={diffTheme()}
                  />
                );
              }}
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
};

export default MobileCodeSheet;
