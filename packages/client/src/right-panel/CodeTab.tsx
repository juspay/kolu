/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * Three sub-tabs share one Pierre file-tree + one Pierre diff/file viewer:
 *   - Local: working tree vs HEAD (uncommitted changes).
 *   - Branch: working tree vs merge-base with `origin/<defaultBranch>` —
 *     forge-agnostic "what this branch will ship".
 *   - Browse: full repo file tree (git-filtered).
 *
 * Pierre's `@pierre/trees` owns the tree layout, search, virtualization,
 * and git-status badges. Pierre's `@pierre/diffs` owns diff parsing and
 * shiki syntax highlighting. This component just wires data flow. */

import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import type { CodeTabView, GitDiffMode, TerminalMetadata } from "kolu-common";
import { client } from "../rpc/rpc";
import { usePreferences } from "../settings/usePreferences";
import { useRightPanel } from "./useRightPanel";
import {
  DiffLocalIcon,
  DiffBranchIcon,
  FileBrowseIcon,
  FileDiffIcon,
  GitBranchIcon,
} from "../ui/Icons";
import PierreFileTree, { toGitStatusEntries } from "../ui/PierreFileTree";
import PierreDiffView from "../ui/PierreDiffView";
import PierreFileView from "../ui/PierreFileView";
import { COMPACT_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

const VIEW_TABS: {
  view: CodeTabView;
  icon: Component<{ class?: string }>;
  tooltip: string;
  label: string;
}[] = [
  {
    view: "local",
    icon: DiffLocalIcon,
    tooltip: "Local changes (vs HEAD)",
    label: "vs HEAD",
  },
  {
    view: "branch",
    icon: DiffBranchIcon,
    tooltip: "Branch diff (vs origin/<default>)",
    label: "vs branch base",
  },
  {
    view: "browse",
    icon: FileBrowseIcon,
    tooltip: "File tree browser",
    label: "Files",
  },
];

const FileSelectHint: Component<{ label: string }> = (props) => (
  <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2">
    <FileDiffIcon class="w-8 h-8 opacity-40" />
    <span class="text-[11px]">{props.label}</span>
  </div>
);

const CodeTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  const { preferences } = usePreferences();
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

  const [browsePaths, { refetch: refetchBrowse }] = createResource(
    () => {
      const p = repoPath();
      return p && view() === "browse" ? { repoPath: p } : null;
    },
    (input) => client.fs.listAll(input).then((r) => r.paths),
  );

  const diffTheme = () =>
    preferences().colorScheme === "light" ? "light" : "dark";

  const handleRefresh = () => {
    if (isDiffView()) {
      void refetchStatus();
      if (selectedPath()) void refetchDiff();
    } else {
      void refetchBrowse();
    }
  };

  const headerLabel = () => {
    const tab = VIEW_TABS.find((t) => t.view === view())!;
    if (view() === "local" || view() === "browse") return tab.label;
    return status()?.base?.ref ? `vs ${status()!.base!.ref}` : tab.label;
  };

  const diffPaths = createMemo(() => status()?.files.map((f) => f.path) ?? []);
  const diffStatus = createMemo(() =>
    status() ? toGitStatusEntries(status()!.files) : [],
  );

  const handleSelect = (path: string | null) => {
    // Pierre emits null on deselect; keep our single-select toggle semantics.
    setSelectedPath((prev) => (prev === path ? null : path));
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
            <For each={VIEW_TABS}>
              {(tab) => (
                <button
                  type="button"
                  onClick={() => setView(tab.view)}
                  title={tab.tooltip}
                  class={`${COMPACT_ICON_BUTTON_CLASS} text-fg-3/50 hover:text-fg-2 data-[active=true]:text-fg data-[active=true]:bg-surface-0 data-[active=true]:shadow-sm`}
                  data-testid={`diff-mode-${tab.view}`}
                  data-active={view() === tab.view}
                  aria-pressed={view() === tab.view}
                >
                  <Dynamic component={tab.icon} class="w-3.5 h-3.5" />
                </button>
              )}
            </For>
          </div>
          <span
            class="text-fg-3/50 text-[10px] font-mono truncate min-w-0 ml-1"
            data-testid="diff-mode-label"
            data-mode={view()}
          >
            {headerLabel()}
          </span>
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

        <Switch>
          {/* === Diff modes (local / branch) === */}
          <Match when={isDiffView()}>
            <div
              class="shrink-0 max-h-[35%] overflow-y-auto border-b border-edge"
              data-testid="diff-file-list"
            >
              <Switch
                fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}
              >
                <Match when={status.error}>
                  <div class="px-2 py-1 text-danger" data-testid="diff-error">
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
                          data-testid="diff-empty"
                        >
                          {EMPTY_STATE[diffMode()!]}
                        </div>
                      }
                    >
                      <PierreFileTree
                        paths={diffPaths()}
                        gitStatus={diffStatus()}
                        selectedPath={selectedPath()}
                        onSelect={handleSelect}
                      />
                    </Show>
                  )}
                </Match>
              </Switch>
            </div>

            <div
              class="flex-1 min-h-0 overflow-auto"
              data-testid="diff-content"
            >
              <Show
                when={selectedPath()}
                fallback={
                  <FileSelectHint label="Select a file to view its diff" />
                }
              >
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
                      File renamed: {diff()!.oldFileName} →{" "}
                      {diff()!.newFileName}
                    </div>
                  </Match>
                  <Match when={diff()}>
                    {(d) => (
                      <PierreDiffView
                        rawDiff={d().hunks[0] ?? ""}
                        oldFileName={d().oldFileName}
                        newFileName={d().newFileName}
                        theme={diffTheme()}
                      />
                    )}
                  </Match>
                </Switch>
              </Show>
            </div>
          </Match>

          {/* === File browser mode === */}
          <Match when={!isDiffView()}>
            <div
              class="shrink-0 max-h-[35%] overflow-y-auto border-b border-edge"
              data-testid="file-browser"
            >
              <Switch
                fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}
              >
                <Match when={browsePaths.error}>
                  <div class="px-2 py-1 text-danger">
                    Error: {(browsePaths.error as Error).message}
                  </div>
                </Match>
                <Match when={browsePaths()}>
                  {(paths) => (
                    <Show
                      when={paths().length > 0}
                      fallback={
                        <div class="px-2 py-4 text-fg-3/50 text-center">
                          Empty repository
                        </div>
                      }
                    >
                      <PierreFileTree
                        paths={paths()}
                        selectedPath={selectedPath()}
                        onSelect={handleSelect}
                      />
                    </Show>
                  )}
                </Match>
              </Switch>
            </div>
            <div
              class="flex-1 min-h-0 overflow-auto"
              data-testid="file-content"
            >
              <Show
                when={selectedPath()}
                fallback={
                  <FileSelectHint label="Select a file to view its content" />
                }
              >
                <BrowseFileView
                  repoPath={repoPath()!}
                  filePath={selectedPath()!}
                  theme={diffTheme()}
                />
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </Show>
  );
};

/** File content viewer for browse mode. Reads the file via RPC and hands
 *  the contents to Pierre's `File` renderer for shiki-powered highlighting. */
const BrowseFileView: Component<{
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
}> = (props) => {
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

export default CodeTab;
