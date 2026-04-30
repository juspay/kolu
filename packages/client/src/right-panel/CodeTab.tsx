/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * One file tree, three modes:
 *   - All: full repo (git-filtered) — selecting a file shows its content.
 *   - Local: working tree vs HEAD (uncommitted) — selecting a file shows the diff.
 *   - Branch: working tree vs `merge-base(origin/<default>)` — same, with a
 *     branch base. Forge-agnostic "what this branch will ship".
 *
 * Mode + filename filtering live side-by-side in `CodeFilterBar`: a chip +
 * popover picks the mode, a free-text input drives Pierre's tree filter
 * via `searchQuery`. Pierre's built-in header search is disabled so the
 * caller-rendered input is the single source of filter state. Pierre's
 * `@pierre/trees` owns the tree layout/virtualization; `@pierre/diffs`
 * owns diff parsing and shiki highlighting. This component is just data
 * flow + chrome. */

import type { CodeTabView, GitDiffMode, TerminalMetadata } from "kolu-common";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { createReactiveSubscription } from "../rpc/createReactiveSubscription";
import { stream } from "../rpc/rpc";
import { useColorScheme } from "../settings/useColorScheme";
import { FileDiffIcon, GitBranchIcon } from "../ui/Icons";
import PierreDiffView from "../ui/PierreDiffView";
import PierreFileTree, { toGitStatusEntries } from "../ui/PierreFileTree";
import BrowseFileView from "./BrowseFileView";
import CodeFilterBar from "./CodeFilterBar";
import { useRightPanel } from "./useRightPanel";

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

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

  // Filename filter — drives Pierre's tree filter externally. Reset on
  // mode switch so a stale needle doesn't hide the wrong file set.
  const [searchQuery, setSearchQuery] = createSignal("");

  const status = createReactiveSubscription(
    () => {
      const p = repoPath();
      const m = diffMode();
      return p && m ? { repoPath: p, mode: m } : null;
    },
    (input, signal) => stream.gitStatus(input.repoPath, input.mode, signal),
    {
      onError: (err) => toast.error(`Git status stream: ${err.message}`),
    },
  );

  const allPaths = createReactiveSubscription(
    () => {
      const p = repoPath();
      return p && view() === "browse" ? { repoPath: p } : null;
    },
    (input, signal) => stream.fsListAll(input.repoPath, signal),
    {
      onError: (err) => toast.error(`File list stream: ${err.message}`),
    },
  );

  const diff = createReactiveSubscription(
    () => {
      const p = repoPath();
      const s = selectedPath();
      const m = diffMode();
      if (!p || !s || !m) return null;
      const file = status()?.files.find((f) => f.path === s);
      return { repoPath: p, filePath: s, mode: m, oldPath: file?.oldPath };
    },
    (input, signal) => stream.gitDiff(input, signal),
    {
      onError: (err) => toast.error(`Git diff stream: ${err.message}`),
    },
  );

  // Reset selection when the repo or view changes so a stale path doesn't
  // bleed across modes (e.g. a browse-mode pick showing up in diff mode).
  // Same reset clears the filename filter — the search needle was scoped
  // to the previous file set and rarely makes sense post-switch.
  createEffect(
    on(
      [repoPath, view],
      () => {
        setSelectedPath(null);
        setSearchQuery("");
      },
      { defer: true },
    ),
  );

  const treePaths = createMemo(() => {
    if (view() === "browse") return allPaths()?.paths ?? [];
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
    isDiffView() ? status.error() : allPaths.error();
  const treeReady = () => (isDiffView() ? status() : allPaths());
  const branchRef = (): string | null => status()?.base?.ref ?? null;

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
        <CodeFilterBar
          view={view()}
          onViewChange={setView}
          searchQuery={searchQuery()}
          onSearchChange={setSearchQuery}
          branchRef={branchRef()}
        />

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
                  search={false}
                  searchQuery={searchQuery()}
                />
              </Show>
            </Match>
          </Switch>
        </div>

        <div class="flex-1 min-h-0 overflow-auto" data-testid="diff-content">
          <Show
            when={selectedPath()}
            keyed
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
            {(path) => (
              // `keyed` remounts this subtree whenever the selected file
              // changes. Pierre's `FileDiff.render(newFileDiff)` reuses
              // the same instance — its line-selection handlers don't
              // re-bind to the new gutter elements, so right-clicking on
              // a line in the second file would yield a "Copy path" menu
              // with no "Copy path:line" entry. Per-file remount gives
              // each file a fresh `FileDiff` and a clean
              // `useLineSelection` range, which is also the right
              // semantic — line refs don't survive across files.
              <Switch>
                <Match when={isDiffView()}>
                  <Switch
                    fallback={
                      <div class="px-2 py-1 text-fg-3/50">Loading diff…</div>
                    }
                  >
                    <Match when={diff.error()}>
                      {(err) => (
                        <div class="px-2 py-1 text-danger">
                          Error: {err().message}
                        </div>
                      )}
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
                        <PierreDiffView
                          path={path}
                          rawDiff={d().hunks[0] ?? ""}
                          theme={diffTheme()}
                        />
                      )}
                    </Match>
                  </Switch>
                </Match>
                <Match when={!isDiffView()}>
                  {(() => {
                    const repo = repoPath();
                    if (repo === null) return null;
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
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default CodeTab;
