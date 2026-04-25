/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * One file tree, three modes:
 *   - All: full repo (git-filtered) — selecting a file shows its content.
 *   - Local: working tree vs HEAD (uncommitted) — selecting a file shows the diff.
 *   - Branch: working tree vs `merge-base(origin/<default>)` — same, with a
 *     branch base. Forge-agnostic "what this branch will ship".
 *
 * The mode trio is structured as a nested segmented control: All sits
 * apart from the Local/Branch pair because Local and Branch are siblings
 * (both filter to changed files; only the diff base differs), while All
 * is the unfiltered base view. Pierre's `@pierre/trees` owns the tree
 * layout/search/virtualization; `@pierre/diffs` owns diff parsing and
 * shiki highlighting. This component is just data flow + chrome. */

import type { CodeTabView, GitDiffMode, TerminalMetadata } from "kolu-common";
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { client } from "../rpc/rpc";
import { useColorScheme } from "../settings/useColorScheme";
import { FileDiffIcon, GitBranchIcon } from "../ui/Icons";
import PierreDiffView from "../ui/PierreDiffView";
import PierreFileTree, { toGitStatusEntries } from "../ui/PierreFileTree";
import BrowseFileView from "./BrowseFileView";
import { useRightPanel } from "./useRightPanel";

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

/** Pill button shared by both segment groups. Inherits the same active-state
 *  chrome the canvas tile chrome uses (lifted surface-0 + soft shadow), so
 *  the mode picker reads as a continuation of kolu's existing tab language. */
const PILL_BUTTON_CLASS =
  "px-2 h-5 rounded text-[10px] font-mono cursor-pointer transition-colors text-fg-3/50 hover:text-fg-2 data-[active=true]:text-fg data-[active=true]:bg-surface-0 data-[active=true]:shadow-sm";

const FileSelectHint: Component<{ label: string }> = (props) => (
  <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2">
    <FileDiffIcon class="w-8 h-8 opacity-40" />
    <span class="text-[11px]">{props.label}</span>
  </div>
);

const CodeTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  const view = (): CodeTabView => {
    const tab = rightPanel.activeTab();
    return tab.kind === "code" ? tab.mode : "local";
  };
  const setView = rightPanel.setCodeMode;

  const repoPath = () => props.meta?.git?.repoRoot ?? null;
  const isDiffView = () => view() !== "browse";
  const diffMode = (): GitDiffMode | undefined =>
    view() === "browse" ? undefined : (view() as GitDiffMode);

  const [status, { refetch: refetchStatus }] = createResource(
    () => {
      const p = repoPath();
      const m = diffMode();
      return p && m ? { repoPath: p, mode: m } : null;
    },
    (input) => client.git.status(input),
  );

  const [allPaths, { refetch: refetchAll }] = createResource(
    () => {
      const p = repoPath();
      return p && view() === "browse" ? { repoPath: p } : null;
    },
    (input) => client.fs.listAll(input).then((r) => r.paths),
  );

  const [diff, { refetch: refetchDiff }] = createResource(
    () => {
      const p = repoPath();
      const s = selectedPath();
      const m = diffMode();
      if (!p || !s || !m) return null;
      const file = status()?.files.find((f) => f.path === s);
      return { repoPath: p, filePath: s, mode: m, oldPath: file?.oldPath };
    },
    (input) => client.git.diff(input),
  );

  // Reset selection when the repo or view changes so a stale path doesn't
  // bleed across modes (e.g. a browse-mode pick showing up in diff mode).
  createEffect(
    on([repoPath, view], () => setSelectedPath(null), { defer: true }),
  );

  const handleRefresh = () => {
    if (isDiffView()) {
      void refetchStatus();
      if (selectedPath()) void refetchDiff();
    } else {
      void refetchAll();
    }
  };

  const treePaths = createMemo(() => {
    if (view() === "browse") return allPaths() ?? [];
    return status()?.files.map((f) => f.path) ?? [];
  });
  const treeGitStatus = createMemo(() => {
    const s = status();
    return s ? toGitStatusEntries(s.files) : undefined;
  });

  const handleSelect = (path: string | null) => {
    // Pierre emits null on deselect; keep our single-select toggle semantics.
    setSelectedPath((prev) => (prev === path ? null : path));
  };

  const treeError = (): Error | undefined =>
    (isDiffView() ? status.error : allPaths.error) as Error | undefined;
  const treeReady = () => (isDiffView() ? status() : allPaths());
  const branchTooltip = () =>
    `Changes vs ${status()?.base?.ref ?? "branch base"}`;

  /** Diff value narrowed to "this is a pure-rename" (no hunks, both old +
   *  new file names present and different). Returning the full diff so the
   *  rendering Match can read its names without re-narrowing. */
  const renamedDiff = createMemo(() => {
    const d = diff();
    if (!d) return undefined;
    if (d.hunks.length !== 0) return undefined;
    const { oldFileName, newFileName } = d;
    if (!oldFileName || !newFileName || oldFileName === newFileName) {
      return undefined;
    }
    return { oldFileName, newFileName };
  });

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
        <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-1.5">
          <div class="flex items-center bg-surface-2/40 rounded p-0.5">
            <button
              type="button"
              onClick={() => setView("browse")}
              title="Browse all files"
              class={PILL_BUTTON_CLASS}
              data-testid="diff-mode-browse"
              data-active={view() === "browse"}
              aria-pressed={view() === "browse"}
            >
              All
            </button>
          </div>
          <div class="flex items-center bg-surface-2/40 rounded p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setView("local")}
              title="Changes vs HEAD"
              class={PILL_BUTTON_CLASS}
              data-testid="diff-mode-local"
              data-active={view() === "local"}
              aria-pressed={view() === "local"}
            >
              Local
            </button>
            <button
              type="button"
              onClick={() => setView("branch")}
              title={branchTooltip()}
              class={PILL_BUTTON_CLASS}
              data-testid="diff-mode-branch"
              data-active={view() === "branch"}
              aria-pressed={view() === "branch"}
            >
              Branch
            </button>
          </div>
          <div class="flex-1" />
          <button
            type="button"
            onClick={handleRefresh}
            class="text-fg-3/40 hover:text-fg-2 cursor-pointer px-1 shrink-0 transition-colors"
            aria-label="Refresh"
            data-testid="diff-refresh"
          >
            ↻
          </button>
        </div>

        <div
          class="shrink-0 h-[35%] min-h-0 border-b border-edge"
          data-testid="diff-file-list"
        >
          <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
            <Match when={treeError()}>
              {(err) => (
                <div class="px-2 py-1 text-danger" data-testid="diff-error">
                  Error: {err().message}
                </div>
              )}
            </Match>
            <Match when={treeReady()}>
              <Show
                when={treePaths().length > 0}
                fallback={
                  <div
                    class="px-2 py-4 text-fg-3/50 text-center"
                    data-testid="diff-empty"
                  >
                    {(() => {
                      const m = diffMode();
                      return m ? EMPTY_STATE[m] : "Empty repository";
                    })()}
                  </div>
                }
              >
                <PierreFileTree
                  paths={treePaths()}
                  gitStatus={treeGitStatus()}
                  selectedPath={selectedPath()}
                  onSelect={handleSelect}
                  initialExpansion={isDiffView() ? "open" : "closed"}
                />
              </Show>
            </Match>
          </Switch>
        </div>

        <div class="flex-1 min-h-0 overflow-auto" data-testid="diff-content">
          <Show
            when={selectedPath()}
            fallback={
              <FileSelectHint
                label={
                  isDiffView()
                    ? "Select a file to view its diff"
                    : "Select a file to view its content"
                }
              />
            }
          >
            <Switch>
              <Match when={isDiffView()}>
                <Switch
                  fallback={
                    <div class="px-2 py-1 text-fg-3/50">Loading diff…</div>
                  }
                >
                  <Match when={diff.error}>
                    <div class="px-2 py-1 text-danger">
                      Error: {(diff.error as Error).message}
                    </div>
                  </Match>
                  <Match when={renamedDiff()}>
                    {(rename) => (
                      <div class="flex items-center justify-center h-full text-fg-3/50">
                        File renamed: {rename().oldFileName} →{" "}
                        {rename().newFileName}
                      </div>
                    )}
                  </Match>
                  <Match when={diff()}>
                    {(d) => (
                      // `selectedPath()` must be read reactively so the
                      // "Copy path:line" menu entry tracks the live file —
                      // capturing it to a `const` here would freeze the
                      // path at the moment this Match callback first ran.
                      <Show when={selectedPath()}>
                        {(path) => (
                          <PierreDiffView
                            path={path()}
                            rawDiff={d().hunks[0] ?? ""}
                            theme={diffTheme()}
                          />
                        )}
                      </Show>
                    )}
                  </Match>
                </Switch>
              </Match>
              <Match when={!isDiffView()}>
                {(() => {
                  const repo = repoPath();
                  const path = selectedPath();
                  if (repo === null || path === null) return null;
                  return (
                    <BrowseFileView
                      repoPath={repo}
                      filePath={path}
                      theme={diffTheme()}
                    />
                  );
                })()}
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default CodeTab;
