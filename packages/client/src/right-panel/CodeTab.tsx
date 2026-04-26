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

import type {
  CodeTabView,
  FsWatchEvent,
  GitDiffMode,
  TerminalMetadata,
} from "kolu-common";
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
import type { FileTreeBatchOperation } from "@pierre/trees";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { client, stream } from "../rpc/rpc";
import { useColorScheme } from "../settings/useColorScheme";
import { FileDiffIcon, GitBranchIcon } from "../ui/Icons";
import PierreDiffView from "../ui/PierreDiffView";
import PierreFileTree, {
  type PierreTreeUpdate,
  toGitStatusEntries,
} from "../ui/PierreFileTree";
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

  // Live file-tree subscription. Drives the browse-mode list (events
  // flow straight into Pierre via the `event` prop on `PierreFileTree`)
  // and acts as the change-notifier for diff modes — every delta
  // triggers a `git.status` refetch so the changed-files list stays in
  // sync with the working tree without a manual ↻.
  //
  // Repo-keyed: rebuilding the subscription when `repoPath` flips means
  // the server's refcounted chokidar singleton tears down the old
  // watcher and starts a fresh one for the new repo. The `repoPath()`
  // read inside the source factory is what makes this happen — Solid
  // tracks it and re-runs the factory when it changes.
  const fsWatch = createSubscription<FsWatchEvent>(
    async () => {
      const p = repoPath();
      if (!p) return (async function* (): AsyncIterable<FsWatchEvent> {})();
      return await stream.fsWatch(p);
    },
    {
      onError: (err) =>
        toast.error(`File watcher subscription error: ${err.message}`),
    },
  );

  // Diff-mode change-detector: any fs delta means git.status may have
  // flipped (file content edited, file added, file removed). Re-fetching
  // is cheap and keeps the local/branch list in sync without a refresh
  // button. `defer: true` skips the initial run — the resource already
  // fetches on first read.
  createEffect(
    on(
      fsWatch,
      (event) => {
        if (event?.kind === "delta" && isDiffView()) {
          void refetchStatus();
        }
      },
      { defer: true },
    ),
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

  // Refetch the open diff on each fs change too — otherwise the diff
  // pane stays frozen on the pre-edit hunk while the file list updates.
  createEffect(
    on(
      fsWatch,
      (event) => {
        if (event?.kind === "delta" && isDiffView() && selectedPath()) {
          void refetchDiff();
        }
      },
      { defer: true },
    ),
  );

  // Reset selection when the repo or view changes so a stale path doesn't
  // bleed across modes (e.g. a browse-mode pick showing up in diff mode).
  createEffect(
    on([repoPath, view], () => setSelectedPath(null), { defer: true }),
  );

  // Path count for the surrounding `<Show>` empty-state check. Pierre
  // itself is fed via the `event` accessor below — this count is just
  // chrome bookkeeping. Tracking a separate signal (rather than
  // reducing the full path list) keeps the per-delta cost O(1).
  const [browseCount, setBrowseCount] = createSignal(0);
  createEffect(() => {
    const ev = fsWatch();
    if (!ev) return;
    if (ev.kind === "snapshot") setBrowseCount(ev.paths.length);
    else setBrowseCount((c) => c + ev.added.length - ev.removed.length);
  });

  const hasTreeFiles = () =>
    isDiffView() ? (status()?.files.length ?? 0) > 0 : browseCount() > 0;
  // Initial path snapshot for `PierreFileTree`. In browse mode this is a
  // bootstrap value used at mount only — once `update` starts firing,
  // Pierre's incremental dispatch takes over and changes to this prop
  // are ignored. In diff mode, where no update stream is wired, this is
  // the live source of truth and gets `resetPaths`'d on every change.
  const treePaths = createMemo(() => {
    if (view() === "browse") {
      const ev = fsWatch();
      return ev?.kind === "snapshot" ? ev.paths : [];
    }
    return status()?.files.map((f) => f.path) ?? [];
  });

  // Translate the wire-shape `FsWatchEvent` into Pierre's vocabulary at
  // this seam (per Lowy: keep `PierreFileTree`'s API in Pierre's terms,
  // not in the server transport's). Removes-then-adds matches the order
  // chokidar prefers (rename = unlink + add); within a batch the order
  // doesn't materially affect Pierre's tree state.
  const treeUpdate = createMemo<PierreTreeUpdate | undefined>(() => {
    const ev = fsWatch();
    if (!ev) return undefined;
    if (ev.kind === "snapshot") return { kind: "reset", paths: ev.paths };
    const ops: FileTreeBatchOperation[] = [
      ...ev.removed.map(
        (path): FileTreeBatchOperation => ({ type: "remove", path }),
      ),
      ...ev.added.map(
        (path): FileTreeBatchOperation => ({ type: "add", path }),
      ),
    ];
    return { kind: "batch", ops };
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
    (isDiffView() ? status.error : fsWatch.error()) as Error | undefined;
  const treeReady = () => (isDiffView() ? status() : !fsWatch.pending());
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
                when={hasTreeFiles()}
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
                  update={view() === "browse" ? treeUpdate : undefined}
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
