/** CodeTab — code review and browsing for the terminal's current repo.
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
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { DiffView, DiffModeEnum } from "@git-diff-view/solid";
import "@git-diff-view/solid/styles/diff-view-pure.css";
// Order matters: this overrides the library CSS imported just above.
import "./code-tab.css";
import type {
  GitChangeStatus,
  GitDiffMode,
  TerminalMetadata,
} from "kolu-common";
import { client } from "../rpc/rpc";
import { useServerState } from "../settings/useServerState";
import {
  DiffLocalIcon,
  DiffBranchIcon,
  FileDiffIcon,
  GitBranchIcon,
} from "../ui/Icons";
import { buildFileTree } from "../ui/buildFileTree";
import FileTree from "../ui/FileTree";

/** Color class for each git status letter. */
const STATUS_COLOR: Record<GitChangeStatus, string> = {
  M: "text-warning",
  A: "text-ok",
  D: "text-danger",
  R: "text-fg-3",
  C: "text-fg-3",
  U: "text-danger",
  T: "text-warning",
  "?": "text-ok",
};

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

/** Sub-tab config for each diff mode. Icons double as the tab's visual
 *  affordance; the tooltip spells out what the mode means. The label
 *  is a short context string shown in the header after the icons. */
const MODE_TABS: {
  mode: GitDiffMode;
  icon: Component<{ class?: string }>;
  tooltip: string;
  label: string;
}[] = [
  {
    mode: "local",
    icon: DiffLocalIcon,
    tooltip: "Local changes (vs HEAD)",
    label: "vs HEAD",
  },
  {
    mode: "branch",
    icon: DiffBranchIcon,
    tooltip: "Branch diff (vs origin/<default>)",
    label: "vs branch base",
  },
];

const CodeTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
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
      if (!p || !s) return null;
      const file = status()?.files.find((f) => f.path === s);
      return { repoPath: p, filePath: s, mode: mode(), oldPath: file?.oldPath };
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

  /** Context label shown after the icon tabs — resolves to the actual
   *  base ref name once status returns (e.g. `origin/master`), falling
   *  back to the static label from MODE_TABS until then. */
  const headerLabel = () => {
    const tab = MODE_TABS.find((t) => t.mode === mode())!;
    if (mode() === "local") return tab.label;
    return status()?.base?.ref ? `vs ${status()!.base!.ref}` : tab.label;
  };

  return (
    <Show
      when={repoPath()}
      fallback={
        <div
          class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]"
          data-testid="diff-no-repo"
        >
          <GitBranchIcon class="w-8 h-8 opacity-40" />
          Not in a git repository
        </div>
      }
    >
      <div
        class="flex flex-col h-full min-h-0 text-[11px]"
        data-testid="diff-tab"
      >
        <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-1">
          <div class="flex items-center bg-surface-2/40 rounded p-0.5 gap-0.5">
            <For each={MODE_TABS}>
              {(tab) => (
                <button
                  type="button"
                  onClick={() => setMode(tab.mode)}
                  title={tab.tooltip}
                  class="flex items-center justify-center w-5 h-5 text-fg-3/50 hover:text-fg-2 cursor-pointer rounded transition-colors data-[active=true]:text-fg data-[active=true]:bg-surface-0 data-[active=true]:shadow-sm"
                  data-testid={`diff-mode-${tab.mode}`}
                  data-active={mode() === tab.mode}
                  aria-pressed={mode() === tab.mode}
                >
                  <Dynamic component={tab.icon} class="w-3 h-3" />
                </button>
              )}
            </For>
          </div>
          <span
            class="text-fg-3/50 text-[10px] font-mono truncate min-w-0 ml-1"
            data-testid="diff-mode-label"
            data-mode={mode()}
          >
            {headerLabel()}
          </span>
          <div class="flex-1" />
          <button
            type="button"
            onClick={handleRefresh}
            class="text-fg-3/40 hover:text-fg-2 cursor-pointer px-1 shrink-0 transition-colors"
            aria-label="Refresh changed files"
            data-testid="diff-refresh"
          >
            ↻
          </button>
        </div>

        <div
          class="shrink-0 max-h-[35%] overflow-y-auto border-b border-edge"
          data-testid="diff-file-list"
        >
          <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
            <Match when={status.error}>
              <div class="px-2 py-1 text-danger" data-testid="diff-error">
                Error: {(status.error as Error).message}
              </div>
            </Match>
            <Match when={status()}>
              {(s) => {
                const tree = createMemo(() => buildFileTree(s().files));
                return (
                  <Show
                    when={s().files.length > 0}
                    fallback={
                      <div
                        class="px-2 py-4 text-fg-3/50 text-center"
                        data-testid="diff-empty"
                      >
                        {EMPTY_STATE[mode()]}
                      </div>
                    }
                  >
                    <FileTree
                      nodes={tree()}
                      selectedPath={selectedPath()}
                      onSelect={(path) =>
                        setSelectedPath((p) => (p === path ? null : path))
                      }
                      renderBadge={(node) =>
                        node.kind === "file" ? (
                          <span
                            class={`inline-flex items-center gap-1 ${STATUS_COLOR[node.status]}`}
                          >
                            <span class="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                            <span class="text-[10px] font-medium">
                              {node.status}
                            </span>
                          </span>
                        ) : null
                      }
                    />
                  </Show>
                );
              }}
            </Match>
          </Switch>
        </div>

        {/* Gutter tightening lives in diff-tab.css — see comment there. */}
        <div class="flex-1 min-h-0 overflow-auto" data-testid="diff-content">
          <Show
            when={selectedPath()}
            fallback={
              <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2">
                <FileDiffIcon class="w-8 h-8 opacity-40" />
                <span class="text-[11px]">Select a file to view its diff</span>
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
              <Match
                when={
                  diff() &&
                  diff()!.hunks.length === 0 &&
                  diff()!.oldFileName &&
                  diff()!.newFileName &&
                  diff()!.oldFileName !== diff()!.newFileName
                }
              >
                <div class="flex items-center justify-center h-full text-fg-3/50">
                  File renamed: {diff()!.oldFileName} → {diff()!.newFileName}
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

export default CodeTab;
