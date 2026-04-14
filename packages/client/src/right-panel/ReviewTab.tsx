/** ReviewTab — diff review for the terminal's current repo.
 *
 * Issue #514:
 *   - Phase 1: lists files changed vs HEAD and renders the unified diff
 *     of the selected file using `@git-diff-view/solid`.
 *   - Phase 2: toggle between "Local" (working tree vs HEAD — what the
 *     agent just touched that isn't committed yet) and "Branch" (working
 *     tree vs merge-base with `origin/<defaultBranch>` — what this
 *     branch will ship, same answer GitHub's "Files changed" tab gives).
 *     Branch mode is forge-agnostic; it runs the same git commands
 *     locally and never calls out to a forge API.
 *
 * Stays narrow by design — no inline comments, no agent handoff. Those
 * land in later phases. */

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
import type { GitDiffMode, TerminalMetadata } from "kolu-common";
import { client } from "../rpc/rpc";
import { useServerState } from "../settings/useServerState";

const MODES: Record<GitDiffMode, string> = {
  local: "Local",
  branch: "Branch",
};

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

const ReviewTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  const { preferences } = useServerState();
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<GitDiffMode>("local");

  const repoPath = () => props.meta?.git?.repoRoot ?? null;

  const [status, { refetch: refetchStatus }] = createResource(
    () => {
      const p = repoPath();
      return p ? { repoPath: p, mode: mode() } : null;
    },
    (input) => client.git.status(input),
  );

  const [diff, { refetch: refetchDiff }] = createResource(
    () => {
      const p = repoPath();
      const s = selectedPath();
      return p && s ? { repoPath: p, filePath: s, mode: mode() } : null;
    },
    (input) => client.git.diff(input),
  );

  // Reset selection when the repo or mode changes — the previous file's
  // path may not exist in the new context (different repo, different diff
  // base), and stale selection would surface as a spurious error row.
  createEffect(
    on([repoPath, mode], () => setSelectedPath(null), { defer: true }),
  );

  const handleRefresh = () => {
    void refetchStatus();
    if (selectedPath()) void refetchDiff();
  };

  const diffTheme = () =>
    preferences().colorScheme === "light" ? "light" : "dark";

  const headerLabel = () => {
    const baseRef = status()?.base?.ref;
    return baseRef ? `Changes vs ${baseRef}` : "Changes";
  };

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
        <div class="flex items-center justify-between h-6 px-2 bg-surface-1/30 border-b border-edge shrink-0 gap-2">
          <div
            class="flex items-center gap-0 text-[9px] font-bold tracking-[0.1em] uppercase"
            data-testid="review-mode-toggle"
          >
            <For each={Object.entries(MODES) as [GitDiffMode, string][]}>
              {([m, label]) => (
                <button
                  type="button"
                  onClick={() => setMode(m)}
                  class="px-1.5 py-0.5 text-fg-3/50 hover:text-fg-2 cursor-pointer data-[active=true]:text-fg data-[active=true]:bg-surface-2/60 rounded-sm"
                  data-testid={`review-mode-${m}`}
                  data-active={mode() === m}
                  aria-pressed={mode() === m}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <span
            class="text-fg-3/70 uppercase tracking-[0.15em] text-[9px] font-bold truncate min-w-0"
            data-testid="review-header-label"
          >
            {headerLabel()}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            class="text-fg-3/50 hover:text-fg-2 cursor-pointer px-1 shrink-0"
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
              {(s) => (
                <Show
                  when={s().files.length > 0}
                  fallback={
                    <div
                      class="px-2 py-4 text-fg-3/50 text-center"
                      data-testid="review-empty"
                    >
                      {EMPTY_STATE[mode()]}
                    </div>
                  }
                >
                  <For each={s().files}>
                    {(f) => (
                      <button
                        type="button"
                        onClick={() =>
                          // Re-click on the active row collapses the diff.
                          setSelectedPath((p) => (p === f.path ? null : f.path))
                        }
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
