/** ReviewTab — local diff review for the terminal's current repo.
 *
 * Phase 1 of issue #514: lists files changed vs HEAD and renders the
 * unified diff of the selected file using `@git-diff-view/solid`.
 *
 * Stays narrow by design — no PR diff, no inline comments, no agent
 * handoff. Those land in later phases. */

import {
  type Component,
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { DiffView, DiffModeEnum } from "@git-diff-view/solid";
import "@git-diff-view/solid/styles/diff-view-pure.css";
// Order matters: this overrides the library CSS imported just above.
import "./review-tab.css";
import type { TerminalMetadata } from "kolu-common";
import { client } from "../rpc/rpc";
import { useServerState } from "../settings/useServerState";

const ReviewTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  const { preferences } = useServerState();
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  const repoPath = () => props.meta?.git?.repoRoot ?? null;

  const [status, { refetch: refetchStatus }] = createResource(
    repoPath,
    (path) => client.git.status({ repoPath: path }),
  );

  const [diff, { refetch: refetchDiff }] = createResource(
    () => {
      const p = repoPath();
      const s = selectedPath();
      return p && s ? { repoPath: p, filePath: s } : null;
    },
    (input) => client.git.diff(input),
  );

  // Reset selection when switching to a different repo — otherwise
  // the previous terminal's selected path bleeds into the new one.
  createEffect(on(repoPath, () => setSelectedPath(null), { defer: true }));

  const handleRefresh = () => {
    void refetchStatus();
    if (selectedPath()) void refetchDiff();
  };

  const diffTheme = () =>
    preferences().colorScheme === "light" ? "light" : "dark";

  return (
    <Show
      when={repoPath()}
      fallback={
        <div
          class="flex items-center justify-center h-full text-fg-3/50 text-[11px]"
          data-testid="review-no-repo"
        >
          Not in a git repository
        </div>
      }
    >
      <div
        class="flex flex-col h-full min-h-0 text-[11px]"
        data-testid="review-tab"
      >
        <div class="flex items-center justify-between h-6 px-2 bg-surface-1/30 border-b border-edge shrink-0">
          <span class="text-fg-3/70 uppercase tracking-[0.15em] text-[9px] font-bold">
            Changes
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            class="text-fg-3/50 hover:text-fg-2 cursor-pointer px-1"
            aria-label="Refresh changed files"
            data-testid="review-refresh"
          >
            ↻
          </button>
        </div>

        <div
          class="shrink-0 max-h-[35%] overflow-y-auto border-b border-edge"
          data-testid="review-file-list"
        >
          <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
            <Match when={status.error}>
              <div class="px-2 py-1 text-danger" data-testid="review-error">
                Error: {(status.error as Error).message}
              </div>
            </Match>
            <Match when={status()}>
              {(files) => (
                <Show
                  when={files().length > 0}
                  fallback={
                    <div
                      class="px-2 py-4 text-fg-3/50 text-center"
                      data-testid="review-empty"
                    >
                      No changes
                    </div>
                  }
                >
                  <For each={files()}>
                    {(f) => (
                      <button
                        type="button"
                        onClick={() => setSelectedPath(f.path)}
                        class="flex w-full items-center gap-2 px-2 py-0.5 text-left font-mono text-fg hover:bg-surface-1 cursor-pointer"
                        classList={{
                          "bg-surface-1": selectedPath() === f.path,
                        }}
                        data-testid="review-file-item"
                        data-path={f.path}
                        data-active={selectedPath() === f.path}
                      >
                        <span class="text-fg-3/70 w-3 shrink-0 text-center">
                          {f.status}
                        </span>
                        <span class="truncate min-w-0">{f.path}</span>
                      </button>
                    )}
                  </For>
                </Show>
              )}
            </Match>
          </Switch>
        </div>

        {/* Gutter tightening lives in review-tab.css — see comment there. */}
        <div class="flex-1 min-h-0 overflow-auto" data-testid="review-diff">
          <Show
            when={selectedPath()}
            fallback={
              <div class="flex items-center justify-center h-full text-fg-3/50">
                Select a file to view its diff
              </div>
            }
          >
            <Switch
              fallback={<div class="px-2 py-1 text-fg-3/50">Loading diff…</div>}
            >
              <Match when={diff.error}>
                <div class="px-2 py-1 text-danger">
                  Error: {(diff.error as Error).message}
                </div>
              </Match>
              <Match when={diff()}>
                {(d) => (
                  <DiffView
                    data={{
                      oldFile: {
                        fileName: d().oldFileName,
                        content: d().oldContent,
                      },
                      newFile: {
                        fileName: d().newFileName,
                        content: d().newContent,
                      },
                      hunks: d().hunks,
                    }}
                    diffViewMode={DiffModeEnum.Unified}
                    diffViewHighlight
                    diffViewTheme={diffTheme()}
                    diffViewFontSize={11}
                    diffViewWrap
                  />
                )}
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default ReviewTab;
