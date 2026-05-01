/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * One file tree, three modes:
 *   - All: full repo (git-filtered) — selecting a file shows its content.
 *   - Local: working tree vs HEAD (uncommitted) — selecting a file shows the diff.
 *   - Branch: working tree vs `merge-base(origin/<default>)` — same, with a
 *     branch base. Forge-agnostic "what this branch will ship".
 *
 * The toolbar combines two independent filter axes — mode picker
 * (`ModeChipPicker`) and filename input (`FileSearchInput`) — in one
 * row. Pierre's built-in tree-header search is disabled so the
 * `FileSearchInput` is the single source of filter state, forwarded
 * via `PierreFileTree.searchQuery`. Pierre's `@pierre/trees` owns the
 * tree layout/virtualization; `@pierre/diffs` owns diff parsing and
 * shiki highlighting. This component is just data flow + chrome. */

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
import { useColorScheme } from "../settings/useColorScheme";
import { app } from "../wire";
import { FileBrowseIcon, FileDiffIcon, GitBranchIcon } from "../ui/Icons";
import PierreDiffView from "../ui/PierreDiffView";
import PierreFileTree, { toGitStatusEntries } from "../ui/PierreFileTree";
import BrowseFileView from "./BrowseFileView";
import FileSearchInput from "./FileSearchInput";
import ModeChipPicker, { type ModeOption } from "./ModeChipPicker";
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

  const status = app.streams.gitStatus.use(
    () => {
      const p = repoPath();
      const m = diffMode();
      return p && m ? { repoPath: p, mode: m } : null;
    },
    {
      onError: (err) => toast.error(`Git status stream: ${err.message}`),
    },
  );

  const allPaths = app.streams.fsListAll.use(
    () => {
      const p = repoPath();
      return p && view() === "browse" ? { repoPath: p } : null;
    },
    {
      onError: (err) => toast.error(`File list stream: ${err.message}`),
    },
  );

  const diff = app.streams.gitDiff.use(
    () => {
      const p = repoPath();
      const s = selectedPath();
      const m = diffMode();
      if (!p || !s || !m) return null;
      const file = status()?.files.find((f) => f.path === s);
      if (!file) return null;
      return { repoPath: p, filePath: s, mode: m, oldPath: file.oldPath };
    },
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

  // Track membership rather than the treePaths array identity: browse paths
  // come from a reconciled store array whose contents can change in place.
  createEffect(
    on(
      () => {
        const s = selectedPath();
        return [s, s ? treePaths().includes(s) : true] as const;
      },
      ([path, pathExists]) => {
        if (path && !pathExists) setSelectedPath(null);
      },
      { defer: true },
    ),
  );

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

  // Mode catalog — owns the list of views, their labels, hints, and
  // test IDs. Adding a new mode (e.g. "stash") happens here, plus the
  // data-source switch above. ModeChipPicker is purely a presenter.
  const modeOptions = createMemo<ModeOption[]>(() => {
    const ref = branchRef();
    return [
      {
        view: "browse",
        label: "All files",
        hint: "Browse the whole repo",
        testId: "diff-mode-browse",
        icon: FileBrowseIcon,
      },
      {
        view: "local",
        group: "Git",
        label: "Local",
        hint: "Working tree vs HEAD",
        testId: "diff-mode-local",
        icon: GitBranchIcon,
      },
      {
        view: "branch",
        group: "Git",
        label: "Branch",
        hint: ref ? `vs ${ref}` : "Working tree vs branch base",
        testId: "diff-mode-branch",
        icon: GitBranchIcon,
      },
    ];
  });

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
        <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-2">
          <ModeChipPicker
            view={view()}
            onViewChange={setView}
            modes={modeOptions()}
          />
          <FileSearchInput value={searchQuery()} onChange={setSearchQuery} />
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
