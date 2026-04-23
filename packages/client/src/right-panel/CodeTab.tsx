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
 *   - Phase 4: full file tree browser — 3rd sub-tab showing the repo's
 *     entire file tree (lazy-loaded, git-filtered).
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
import hljs from "highlight.js";
import { DiffView, DiffModeEnum } from "@git-diff-view/solid";
import "@git-diff-view/solid/styles/diff-view-pure.css";
// Order matters: this overrides the library CSS imported just above.
import "./code-tab.css";
import type {
  CodeTabView,
  GitChangeStatus,
  GitDiffMode,
  FsListDirOutput,
  TerminalMetadata,
} from "kolu-common";
import { client } from "../rpc/rpc";
import { usePreferences } from "../settings/usePreferences";
import {
  DiffLocalIcon,
  DiffBranchIcon,
  FileBrowseIcon,
  FileDiffIcon,
  GitBranchIcon,
} from "../ui/Icons";
import { buildFileTree } from "../ui/buildFileTree";
import type { TreeNode } from "../ui/buildFileTree";
import FileTree from "../ui/FileTree";
import { COMPACT_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";

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

/** Sub-tab config. Icons double as the tab's visual affordance;
 *  the tooltip spells out what the mode means. */
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

/** Empty-state placeholder shown when no file is selected. */
const FileSelectHint: Component<{ label: string }> = (props) => (
  <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2">
    <FileDiffIcon class="w-8 h-8 opacity-40" />
    <span class="text-[11px]">{props.label}</span>
  </div>
);

/** Convert fs.listDir entries to TreeNode[]. */
function entriesToNodes(entries: FsListDirOutput["entries"]): TreeNode[] {
  return entries.map(
    (e): TreeNode =>
      e.isDirectory
        ? { kind: "dir", name: e.name, path: e.path, children: [] }
        : { kind: "file", name: e.name, path: e.path },
  );
}

const CodeTab: Component<{
  meta: TerminalMetadata | null;
  /** Active sub-view, threaded through from the panel host so it survives
   *  panel re-mount and round-trips to the server as part of the
   *  `{ kind: "code", mode }` PanelContent variant. */
  mode: CodeTabView;
  onModeChange: (mode: CodeTabView) => void;
}> = (props) => {
  const { preferences } = usePreferences();
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const view = (): CodeTabView => props.mode;
  const setView = (mode: CodeTabView) => props.onModeChange(mode);

  const repoPath = () => props.meta?.git?.repoRoot ?? null;

  /** Whether the current view is a diff mode (local/branch). */
  const isDiffView = () => view() !== "browse";
  /** The GitDiffMode for diff views (undefined in browse mode). */
  const diffMode = () => {
    const v = view();
    return v === "browse" ? undefined : v;
  };

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

  // Reset selection when the repo or view changes.
  createEffect(
    on([repoPath, view], () => setSelectedPath(null), { defer: true }),
  );

  const handleRefresh = () => {
    if (isDiffView()) {
      void refetchStatus();
      if (selectedPath()) void refetchDiff();
    } else {
      void refetchBrowseRoot();
    }
  };

  const diffTheme = () =>
    preferences().colorScheme === "light" ? "light" : "dark";

  /** Context label shown after the icon tabs. */
  const headerLabel = () => {
    const tab = VIEW_TABS.find((t) => t.view === view())!;
    if (view() === "local" || view() === "browse") return tab.label;
    return status()?.base?.ref ? `vs ${status()!.base!.ref}` : tab.label;
  };

  // --- File browser state ---

  /** Root entries for the file browser. */
  const [browseRoot, { refetch: refetchBrowseRoot }] = createResource(
    () => {
      const p = repoPath();
      if (!p || view() !== "browse") return null;
      return { repoPath: p, dirPath: "" };
    },
    async (input) => {
      const result = await client.fs.listDir(input);
      return entriesToNodes(result.entries);
    },
  );

  /** Load children for a directory in browse mode. */
  const loadBrowseChildren = async (dirPath: string): Promise<TreeNode[]> => {
    const p = repoPath();
    if (!p) return [];
    const result = await client.fs.listDir({ repoPath: p, dirPath });
    return entriesToNodes(result.entries);
  };

  /** File content for the selected file in browse mode. */
  const [fileContent] = createResource(
    () => {
      const p = repoPath();
      const s = selectedPath();
      if (!p || !s || view() !== "browse") return null;
      return { repoPath: p, filePath: s };
    },
    (input) => client.fs.readFile(input),
  );

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
                            {EMPTY_STATE[diffMode()!]}
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
                            node.kind === "file" && node.status ? (
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
                <Match when={browseRoot.error}>
                  <div class="px-2 py-1 text-danger">
                    Error: {(browseRoot.error as Error).message}
                  </div>
                </Match>
                <Match when={browseRoot()}>
                  {(nodes) => (
                    <Show
                      when={nodes().length > 0}
                      fallback={
                        <div class="px-2 py-4 text-fg-3/50 text-center">
                          Empty directory
                        </div>
                      }
                    >
                      <FileTree
                        nodes={nodes()}
                        selectedPath={selectedPath()}
                        onSelect={(path) =>
                          setSelectedPath((p) => (p === path ? null : path))
                        }
                        loadChildren={loadBrowseChildren}
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
                <Switch
                  fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}
                >
                  <Match when={fileContent.error}>
                    <div class="px-2 py-1 text-danger">
                      Error: {(fileContent.error as Error).message}
                    </div>
                  </Match>
                  <Match when={fileContent()}>
                    {(fc) => {
                      const highlighted = createMemo(() => {
                        const path = selectedPath() ?? "";
                        const ext = path.split(".").pop() ?? "";
                        const lang = hljs.getLanguage(ext) ? ext : undefined;
                        return lang
                          ? hljs.highlight(fc().content, { language: lang })
                          : hljs.highlightAuto(fc().content);
                      });
                      return (
                        <>
                          <Show when={fc().truncated}>
                            <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
                              File truncated (exceeds 1 MB)
                            </div>
                          </Show>
                          <pre
                            class="px-2 py-1 font-mono text-[11px] text-fg whitespace-pre-wrap break-all leading-relaxed"
                            style={{ "tab-size": "2" }}
                          >
                            {/* Safe: highlight.js escapes HTML entities before
                                wrapping tokens in <span> tags. The input is file
                                content read from the user's own repo. */}
                            <code
                              class="hljs"
                              innerHTML={highlighted().value}
                            />
                          </pre>
                        </>
                      );
                    }}
                  </Match>
                </Switch>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </Show>
  );
};

export default CodeTab;
