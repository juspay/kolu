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

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

/** What the cycle-on-click header label shows for each mode. The label
 *  *is* the mode switch — clicking it flips to the other mode. */
const MODE_REF: Record<GitDiffMode, string> = {
  local: "HEAD",
  branch: "branch base",
};

/** Tooltip shown in the current mode, describing the click action. */
const MODE_SWITCH_TOOLTIP: Record<GitDiffMode, string> = {
  local: "Switch to branch diff (vs origin/<default>)",
  branch: "Switch to local changes (vs HEAD)",
};

/** Plain-English annotation shown after the ref — disambiguates `HEAD`
 *  and `origin/master` for users who don't immediately parse them, and
 *  surfaces what each mode actually answers. */
const MODE_HINT: Record<GitDiffMode, string> = {
  local: "uncommitted only",
  branch: "this branch's diff",
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

  /** The ref name to show in the header: real `base.ref` once status
   *  returns; a short placeholder before that (or if branch mode errored
   *  before resolving). Local mode is always `HEAD` — no server trip. */
  const headerRef = () =>
    mode() === "local" ? "HEAD" : (status()?.base?.ref ?? MODE_REF.branch);

  const cycleMode = () => setMode((m) => (m === "local" ? "branch" : "local"));

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
          <button
            type="button"
            onClick={cycleMode}
            title={MODE_SWITCH_TOOLTIP[mode()]}
            class="group flex-1 min-w-0 text-left text-fg-3/70 hover:text-fg-2 cursor-pointer truncate"
            data-testid="review-mode-label"
            data-mode={mode()}
          >
            <span>Changes vs </span>
            <span class="underline-offset-2 decoration-dotted group-hover:underline font-mono text-fg-2/90">
              {headerRef()}
            </span>
            <span class="ml-1.5 text-fg-3/50 italic">
              · {MODE_HINT[mode()]}
            </span>
          </button>
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
